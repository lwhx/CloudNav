# 体验拓展与优化方案

> 状态：**待实施**（先写计划，分批落地）
> 部署目标：**Cloudflare Pages + Functions**（Workers 运行时）
> 验收基线：`npx tsc --noEmit` + `npm run build` 通过

---

## 一、Cloudflare 适配总原则

本项目部署在 Cloudflare Pages（静态前端）+ Functions（`functions/api/*` 在 Workers 运行时执行）。因此：

| 能力 | 落点 | 说明 |
|------|------|------|
| 拼音搜索、防抖、空状态、Esc | **纯前端**（React/TSX） | 不触碰服务端，bundle 体积关注 |
| 死链检查、批量探测 | **functions/api/**（Workers） | 复用已有 SSRF 防护（`isBlockedHostname`/`normalizeMetadataUrl`），有 CPU/子请求配额限制 |
| 统计聚合（分类分布、重复检测） | **纯前端**（基于已加载的 links 计算） | 不需要服务端，数据已在客户端 |

**Workers 限制注意**：
- 死链检查的并发子请求要节制（Workers 免费版 50 子请求/请求，付费版更高），用有限并发 + 限流。
- 不能用 Node 专有 API（`child_process`/`fs`/`net`），只能用 `fetch`/`crypto`/Web 标准 API。
- KV 读写已有限流（`isRateLimited`），死链检查端点复用同一限流桶或独立桶。

---

## 二、批次划分

| 批次 | 内容 | 风险 | 新依赖 | 改动文件数 |
|------|------|------|--------|------------|
| **批次 A** | 拼音搜索 + 搜索防抖 | 低（纯前端，新增轻量库） | `pinyin-pro` | 3（App.tsx、新增 hook、vite 分包） |
| **批次 B** | 空状态引导 + Esc 关闭弹窗 | 低（纯 UI） | 无 | 2（App.tsx + 新 hook/组件） |
| **批次 C** | 数据洞察面板（含服务端死链检查） | 中（新增服务端端点 + UI） | 无 | 4（新组件、新 API、App.tsx） |

每批独立提交、独立验证、独立推送。

---

## 三、批次 A — 拼音搜索 + 搜索防抖

### 3.1 拼音搜索

**现状**：`App.tsx:67-79` `matchesLinkQuery` 仅做 `.toLowerCase().includes()`，输入 "kaifa" 找不到 "开发工具"。

**方案**：
- 新增依赖 `pinyin-pro`（纯前端、~30KB gzip、支持全拼+首字母+声调）。
- 改造 `matchesLinkQuery`：对每个链接预计算拼音索引（全拼小写 + 首字母小写），搜索时同时匹配汉字原文、全拼、首字母。
- **预计算缓存**：拼音转换有开销，不能每次按键都算。用 `useMemo` 按 `links` 生成 `Map<linkId, {full, initial}>`，links 变化时才重算。
- **匹配逻辑**：
  ```
  const haystack = [
    link.title,
    link.url,
    link.description,
    ...tags,
    pinyinIndex.get(link.id)?.full,      // "kaifagongju"
    pinyinIndex.get(link.id)?.initial,   // "kfgj"
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
  ```
- `#tag` 前缀逻辑保留不变（仍按标签精确匹配）。

**Cloudflare 适配**：纯前端，无影响。`pinyin-pro` 走 vite 分包（`vendor-pinyin`），避免拖慢首屏。

### 3.2 搜索防抖

**现状**：`App.tsx:1265` `setSearchQuery(e.target.value)` 每次按键直接写 state，触发 `useMemo`（`:704-730`）全量重算 + 全量渲染。

**方案**：
- 新增 `hooks/useDebouncedValue.ts`：`useDebouncedValue(value, delay)` 返回防抖后的值。
- 搜索输入仍实时更新一个 `searchInput` state（输入框受控），但 `useMemo` 和过滤逻辑改用 `const searchQuery = useDebouncedValue(searchInput, 200)`。
- 输入框响应不延迟（用户打字流畅），过滤重算延迟 200ms。

### 3.3 验收
- 输入 "kaifa" 能命中 "开发工具"、"AI" 命中含 "人工智能" 的标题；
- 连续快速输入时过滤不抖动（防抖生效）；
- `#标签` 仍按原逻辑工作；
- bundle 含 `vendor-pinyin` 分包，首屏 index chunk 未明显增大。

---

## 四、批次 B — 空状态引导 + Esc 关闭弹窗

### 4.1 空状态引导

**现状**：`App.tsx:1561-1572` 当 `displayedLinks.length === 0` 且分类未锁定时，渲染 `<></>`（空白虚线框），无引导。

**方案**：未锁定空状态下显示引导卡片：
```
┌─────────────────────────────────┐
│        📑 (大图标)              │
│                                 │
│    这里还没有链接               │
│    开始构建你的导航吧           │
│                                 │
│   [+ 添加链接]  [📥 导入书签]   │
└─────────────────────────────────┘
```
- 「添加链接」→ `setEditingLink(undefined); setIsModalOpen(true)`
- 「导入书签」→ 打开 ImportModal（`setIsImportModalOpen(true)`）
- 仅在 `selectedCategory === 'all'` 或当前分类为空时显示；搜索无结果时显示"未找到匹配的链接，试试其他关键词"。

### 4.2 Esc 关闭弹窗

**现状**：所有 modal 只能用 X 按钮关闭，无 Escape 处理（全站仅 `App.tsx:1266` 一个 keydown）。

**方案**：
- 新增 `hooks/useEscapeKey.ts`：`useEscapeKey(onEscape, isActive)` 全局监听 Escape，`isActive` 控制是否启用（弹窗打开时才挂载）。
- 应用到所有 modal：`LinkModal`、`SettingsModal`、`ImportModal`、`CategoryManagerModal`、`BackupModal`、`TrashModal`、`OrganizePreviewModal`、各 Auth modal。
- 实现方式：各 modal 内部用 `useEscapeKey(onClose, isOpen)`。
- 注意：多个弹窗同时打开时（如 SettingsModal 里再开 OrganizePreviewModal），只有最顶层响应——通过 z-index 最高的捕获，或用栈管理。简单做法：每个 modal 独立监听，Escape 触发时关闭所有打开的（一般不会同时开多个，可接受）。

### 4.3 验收
- 删空链接后看到引导卡片，点按钮能打开对应弹窗；
- 搜索无结果显示"未找到"提示；
- 任意打开的弹窗按 Esc 关闭；
- 多弹窗嵌套时 Esc 不会导致误关闭底层（用 isActive 控制）。

---

## 五、批次 C — 数据洞察面板

### 5.1 目标
新增一个"统计/洞察"页面，展示：
- 分类分布（每个分类的链接数，可视化条形图）
- 标签频率 Top 10
- 最近添加（按 createdAt 排序，最新 10 条）
- 重复链接检测（相同 URL 的链接）
- 死链检查（可选，需服务端探测）

### 5.2 纯前端部分（无服务端依赖）

**数据源**：客户端已有的 `links`、`categories`。在 `App.tsx` 或新组件内用 `useMemo` 聚合：

```ts
// 分类分布
const categoryStats = useMemo(() => {
  const map = new Map<string, number>();
  links.filter(l => !l.deletedAt).forEach(l => map.set(l.categoryId, (map.get(l.categoryId) || 0) + 1));
  return categories.filter(c => !c.deletedAt).map(c => ({ ...c, count: map.get(c.id) || 0 }));
}, [links, categories]);

// 标签频率
const tagStats = useMemo(() => {
  const map = new Map<string, number>();
  links.filter(l => !l.deletedAt).forEach(l => (l.tags || []).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}, [links]);

// 重复链接（规范化 URL 后比对）
const duplicates = useMemo(() => {
  const map = new Map<string, LinkItem[]>();
  links.filter(l => !l.deletedAt).forEach(l => {
    const key = l.url.trim().replace(/\/$/, '').toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  });
  return [...map.values()].filter(arr => arr.length > 1);
}, [links]);
```

### 5.3 服务端部分（死链检查）

**新增端点**：`functions/api/storage-linkcheck.ts`（`onRequestPost`）
- 入参：`{ urls: string[] }`（一批 URL）
- 复用 `storage-metadata.ts` 的 `fetchMetadataResponse`（已有 SSRF 防护 + 重定向跟踪 + 大小限制）。
- 对每个 URL 做 HEAD 或 GET，记录状态码（200 OK / 4xx / 5xx / 超时/DNS 失败）。
- **有限并发**（Workers 内，并发 5）、**整体超时**（每 URL 最多 8s）、**子请求预算**（单次 API 调用最多 50 个 URL，超出分批）。
- **鉴权**：`validateAuth(request, env, corsHeaders, { requireSession: true })`，只允许已登录用户。
- **限流**：`isRateLimited(env, request, 'linkcheck', 5)`（每分钟 5 次，死链检查是重操作）。
- 返回：`{ results: [{ url, status, ok }] }`，`status` 为 HTTP 状态码或 `'error'`（网络/DNS 失败，不回显内部错误细节）。

**Cloudflare 适配要点**：
- Workers 子请求配额：免费版 50/请求，付费版更高。前端分批，每批 ≤ 30 个 URL。
- 不能用 Node 的 `http`/`dns`，只能 `fetch`。
- 错误信息脱敏：DNS/TLS 错误不回显 hostname（沿用 #5 的规范）。
- 死链检查是**按需触发**（用户点"检查死链"按钮才跑），不在加载时自动跑。

### 5.4 UI 组件

**新增 `components/StatsModal.tsx`**（从设置或顶栏入口打开）：
- 分类分布：水平条形图（纯 div + width%，无图表库依赖）。
- 标签 Top 10：标签云或列表。
- 最近添加：列表。
- 重复链接：列表 + 「查看」跳转。
- 死链检查：按钮触发 → 显示进度 → 列表（状态码红/绿）+ 「编辑/删除」快捷操作。

**入口**：顶栏加一个"统计"图标按钮，或在 SettingsModal 加一个 tab。

### 5.5 验收
- 统计数据准确（与实际链接数一致）；
- 重复链接正确识别（URL 大小写/尾斜杠归一化）；
- 死链检查：限流生效、错误脱敏、不超 Workers 配额；
- 统计页响应快（纯前端聚合 < 50ms）。

---

## 六、全局注意事项

1. **无障碍**：新增 UI（引导卡片、统计图表、按钮）都要加 `aria-label`，符合批次 B 的 a11y 方向。
2. **暗色模式**：所有新 UI 用 `dark:` 变体，与现有风格一致。
3. **移动端**：统计页和引导卡片要在小屏可用（响应式布局）。
4. **性能**：拼音索引、统计聚合都用 `useMemo`，避免每次渲染重算。
5. **bundle 体积**：`pinyin-pro` 单独分包；统计页用懒加载（`React.lazy` + 动态 import）。

---

## 七、实施顺序

1. **批次 A**（拼音 + 防抖）—— 改动小、收益大、用户最常感知。
2. **批次 B**（空状态 + Esc）—— 纯 UI，零风险。
3. **批次 C**（洞察面板）—— 最大功能拓展，含服务端，最后做。

每批做完都 `tsc` + `build` + 推送，可随时停下。
