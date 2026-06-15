# AI 深度整理功能优化方案

> 状态：**待实施**（本文档先写计划，不改代码，后续按批次落地）
> 范围：`services/geminiService.ts`、`components/SettingsModal.tsx`、`functions/api/storage-metadata.ts`（复用）
> 验收基线：`npx tsc --noEmit` + `npm run build` 通过

---

## 一、目标与背景

当前「AI 深度整理」存在以下问题（详见上一轮审查）：

1. 每个书签串行发一次请求，大批量整理耗时不可接受；
2. 失败判定过宽，会**静默丢弃**用户已勾选项的整理结果；
3. 解析失败时无任何日志，排查困难；
4. 模型只拿到 title/url，看不到页面正文，泛化标题的分类/描述质量低；
5. 整理结果**直接覆盖**，无预览/撤销，AI 误分类会破坏用户手动数据。

同时用户提出三项**新需求**：

- **A. 移除 Google Gemini 原生分支**，AI 统一走 OpenAI 兼容协议（用户可继续用 Gemini 的 OpenAI 兼容端点）。
- **B. 默认增量整理**：只整理「缺描述 / 缺分类 / 缺标签」的链接，已有完整数据的跳过。
- **C. 整理前弹选项**：全量整理 / 增量整理 / 取消。

---

## 二、批次划分（按投入产出比）

| 批次 | 内容 | 风险 | 预计改动文件数 |
|------|------|------|----------------|
| **批次 0** | 移除 Gemini 原生分支（需求 A） | 低（纯删减） | 2（geminiService.ts、vite.config.ts） |
| **批次 1** | 抓取页面 meta 喂给模型（优化 #8）+ 整理范围弹窗（需求 B/C） | 中（新增网络抓取） | 3（geminiService.ts、SettingsModal.tsx、storage-metadata.ts） |
| **批次 2** | 失败判定修正（#3）+ 解析日志（#4） | 低 | 1（SettingsModal.tsx + geminiService.ts） |
| **批次 3** | 有限并发（#1） | 中 | 1（SettingsModal.tsx） |
| **批次 4** | 结果预览/撤销（#10） | 中（UI 较多） | 2（SettingsModal.tsx + 新组件） |

每批独立提交、独立验证、独立推送，可随时停下。

---

## 三、批次 0 — 移除 Gemini 原生分支

### 3.1 现状
`services/geminiService.ts` 共 4 个函数含 Gemini 专用分支（`provider.provider === 'gemini'` → `new GoogleGenAI(...)`）：

- 行 118 `generateLinkDescription`
- 行 151 `suggestCategory`
- 行 207 `organizeLink`
- 行 278 `suggestCategoryStructure`

另：
- 行 1：`import { GoogleGenAI, GenerateContentResponse } from "@google/genai";`
- `vite.config.ts:30`：`if (id.includes('@google/genai')) return 'vendor-ai';` 分包配置
- `package.json`：`@google/genai` 依赖（**保留**，因为不删依赖只删调用更安全；用户若用 Gemini OpenAI 兼容端点仍可用）

### 3.2 改动

**a) `services/geminiService.ts`**
- 删除行 1 的 import。
- 4 个函数内，删除 `if (provider.provider === 'gemini') { ... } else { ... }` 结构，统一为：
  ```ts
  const systemPrompt = 'You are a bookmark organization assistant. You only return valid JSON.';
  const raw = await callOpenAICompatible(provider, systemPrompt, prompt);
  ```
  （`organizeLink` 已有 systemPrompt，其余函数补上合适的 systemPrompt）
- `callOpenAICompatible` 内的 model 默认值：当前无默认，需补 `provider.model || 'gpt-4o-mini'`，避免空 model 报错。
- 用户仍想用 Gemini：在 AI 配置里填 baseUrl=`https://generativelanguage.googleapis.com/v1beta/openai/v1`、model=`gemini-2.5-flash`，走 OpenAI 兼容路径即可（Gemini 官方支持该端点）。

**b) `vite.config.ts`**
- 删除行 30 的 `if (id.includes('@google/genai')) return 'vendor-ai';`（不再打包该 SDK）。
- 若 `vendor-ai` 分包已无其他命中项，可一并清理 `manualChunks` 里的 `vendor-ai` 条目。

**c) 类型清理**
- 检查 `AIProviderConfig.provider` 字段是否还有 `'gemini'` 字面量类型；若移除，需同步改 `aiConfigService.ts` 的 `getActiveAIProvider`（保留 `provider` 字段为可选字符串即可，不强制删，向后兼容已有配置）。

### 3.3 验收
- `tsc --noEmit` 通过；
- 用 OpenAI 兼容端点（OpenAI / Gemini OpenAI 兼容 / 本地 LLM）分别测试整理、描述生成、分类建议三功能；
- 打包后 bundle 不再含 `@google/genai`（可 `grep` dist 目录确认）。

---

## 四、批次 1 — 抓取页面 meta + 整理范围弹窗

### 4.1 优化 #8：整理前抓取页面元信息

**目标**：把页面的 `<meta name="description">`、`<meta property="og:description">`、`og:title`、`og:site_name` 喂给模型，提升泛化标题的分类/描述质量。

**复用现有能力**：仓库已有 `functions/api/storage-metadata.ts`（SSRF 防护 + 标题抓取），它通过 `/api/storage-metadata` 端点返回页面元信息。新增一个轻量字段返回 description。

**改动**：

**a) `functions/api/storage-metadata.ts`**
- 在返回结构里增加 `description?: string`（从 `<meta name="description">` / `og:description` 提取，截断到 ~200 字符）。
- 抓取逻辑已有（fetch + HTML 解析），仅需多提取两个 meta。

**b) `services/geminiService.ts` — `organizeLink`**
- 新增可选参数 `pageMeta?: { title?: string; description?: string }`。
- prompt 里增加一段「页面内容线索」：
  ```
  页面标题：${pageMeta?.title || title}
  页面描述：${pageMeta?.description || '（未抓取到）'}
  ```
- 当 `pageMeta` 缺失时，回退到现状（只用 title/url），保证向后兼容。

**c) `components/SettingsModal.tsx` — 整理循环内**
- 调用 `organizeLink` 前，先 `fetch('/api/storage-metadata?url=...')` 取 meta，再传入。
- **注意**：这会增加每条链接一次额外网络请求。需配合批次 3 的并发控制，否则串行下更慢。**决策点**：是否对每条都抓 meta？建议：
  - **方案 A（推荐）**：仅当 title 为泛化词（如「首页」「常用」「工具」「导航」或长度 ≤ 4 字）时才抓 meta，减少 80% 的额外请求。
  - 方案 B：全部抓，准确率最高但耗时翻倍。

### 4.2 需求 B/C：整理范围弹窗 + 增量默认

**目标**：点击「深度整理」按钮后，先弹一个对话框让用户选择整理范围。

**UI 设计**（新增一个轻量确认弹窗，或复用现有 confirm 风格）：

```
┌─────────────────────────────────────────┐
│  AI 深度整理                              │
├─────────────────────────────────────────┤
│  请选择整理范围：                          │
│                                          │
│  ○ 增量整理（推荐）                       │
│    仅整理缺少描述/分类/标签的链接          │
│    （当前共 N 条待整理）                  │
│                                          │
│  ○ 全量整理                              │
│    重新整理所有链接（含已有数据的）        │
│    （当前共 M 条）                        │
│                                          │
│         [取消]      [开始整理]            │
└─────────────────────────────────────────┘
```

**数据流改动**（`components/SettingsModal.tsx`）：

1. 新增状态：`const [organizeScope, setOrganizeScope] = useState<'incremental' | 'full' | null>(null);`
2. 「深度整理」按钮点击 → 不再直接 `confirm(...)`，改为打开范围选择弹窗（`setOrganizeScope('incremental')` 作为默认选中项，同时展示两种范围的数量）。
3. 用户点「开始整理」→ 根据选中的 scope 过滤 `targetLinks`：
   ```ts
   const isIncomplete = (link: LinkItem) =>
     !link.description?.trim() || !link.categoryId || (!link.tags || link.tags.length === 0);
   const targetLinks = links.filter(link =>
     !link.deletedAt
     && !lockedCatIds.has(link.categoryId)
     && (organizeScope === 'full' || isIncomplete(link))
   );
   ```
4. **「缺分类」判定**：`!link.categoryId`。但现有数据里 categoryId 几乎都有值（默认 common），所以增量判定实际主要由 description 和 tags 决定。**决策点**：是否把「分类是 common 且链接很多」也算"缺分类"？建议**不算**（common 是合法分类），避免误伤。

**判定逻辑细节**（避免歧义）：
- 缺描述：`!link.description || !link.description.trim()`
- 缺分类：`!link.categoryId`（严格无值才算缺）
- 缺标签：`!link.tags || link.tags.length === 0`
- 满足任一即视为"不完整"，纳入增量整理。

### 4.3 验收
- 增量整理：只对不完整链接发起请求；
- 全量整理：对所有非删除、非受锁链接发起请求；
- 页面 meta 抓取失败时不阻塞整理（回退到 title/url）；
- 范围弹窗的 N/M 计数正确。

---

## 五、批次 2 — 失败判定修正 + 解析日志

### 5.1 优化 #3：失败判定应针对勾选项

**现状 bug**（`SettingsModal.tsx:246`）：
```ts
if (!result.description && !result.categoryId && (!result.tags || result.tags.length === 0)) {
  failedCount += 1; ...
}
```
问题：用户只勾了"补描述"，模型返回空 description + 意外的 categoryId → result 非空 → 不计失败 → 但因 `organizeOptions.description && result.description` 过滤，description 没写入 → **静默丢弃，用户以为成功**。

**修正**：失败判定改为"针对用户勾选的、且本次目标缺失的字段，是否返回了有效值"：
```ts
const wantedDesc = organizeOptions.description && !link.description;   // 本条是否需要补描述
const wantedCat  = organizeOptions.category;                          // 是否需要分类
const wantedTags = organizeOptions.tags && (!link.tags || link.tags.length === 0); // 是否需要标签

const gotDesc  = !!result.description;
const gotCat   = !!result.categoryId;
const gotTags  = !!(result.tags && result.tags.length);

const anyWanted = wantedDesc || wantedCat || wantedTags;
const anyGot    = (wantedDesc && gotDesc) || (wantedCat && gotCat) || (wantedTags && gotTags);
if (anyWanted && !anyGot) {
  failedCount += 1;
  // 记录是哪几项没拿到，便于日志
}
```

> 注：批次 1 落地后，"本条是否需要补描述"会与增量判定联动；全量模式下 wantedDesc 即使 link 已有 description 也算 true（用户主动要求重整）。

### 5.2 优化 #4：解析失败加日志

**现状**（`geminiService.ts:16-27`）：`parseOrganizeResult` catch 直接返回 `{}`，无任何信息。

**修正**：catch 里输出脱敏日志（参考已完成的 #12b 脱敏规范，不输出完整 raw）：
```ts
} catch (e) {
  console.warn('parseOrganizeResult failed:', e instanceof Error ? e.name : 'unknown',
    'raw length:', value.length, 'raw head:', value.slice(0, 80));
  return {};
}
```
只取前 80 字符，足以定位"模型返回了什么非 JSON"，又不泄露可能的 prompt 内容。

**同理** `parseCategorySuggestions`（行 48）也补 warn。

### 5.3 验收
- 用户只勾一项时，该项未返回 → 计入 failedCount，提示准确；
- 模型返回非 JSON 时，控制台有可排查的 warn；
- 日志不含完整 prompt/response（脱敏合规）。

---

## 六、批次 3 — 有限并发

### 6.1 现状
`SettingsModal.tsx:238` 串行 `for` 循环，N 条 = N 次串行 RTT。

### 6.2 改动

**并发控制**（不引入新依赖，手写一个 `pLimit`）：

```ts
// 在 SettingsModal.tsx 内或新建 utils/concurrency.ts
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean,
  onProgress?: (done: number) => void,
): Promise<{ result: R[]; index: number }[]> {
  const results: { result: R; index: number }[] = [];
  let done = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldStop()) return;
      const i = cursor++;
      try {
        const r = await fn(items[i], i);
        results.push({ result: r, index: i });
      } catch (e) {
        results.push({ result: null as unknown as R, index: i }); // 失败占位
      }
      done++;
      onProgress?.(done);
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.index - b.index);
}
```

**接入**（替换 `SettingsModal.tsx:238-271` 的循环）：
- `concurrency = 4`（保守值，避免触发 API 限流；可后续做成配置项）。
- 进度更新改为 worker 内回调 `onProgress`。
- `currentLinks` 累积：并发下不能再用循环内闭包的 `currentLinks = currentLinks.map(...)`，改为**先收集 patch，全部完成后一次性合并**：
  ```ts
  const patches = new Map<string, AIOrganizeResult>(); // linkId -> result
  await mapWithConcurrency(targetLinks, 4, async (link) => {
    const result = await organizeLink(...);
    if (result有效) patches.set(link.id, result);
  }, () => shouldStopRef.current, (done) => setProgress({ current: done, total: targetLinks.length }));
  // 合并
  const currentLinks = links.map(item => patches.has(item.id) ? applyPatch(item, patches.get(item.id)!) : item);
  onUpdateLinks(currentLinks);
  ```

### 6.3 注意事项
- **停止语义**：用户点"停止"后，已在途的请求会完成（不 abort），但不再发新请求。当前 `shouldStopRef` 已支持这个语义，并发版沿用。
- **tagPool 增量**：并发下 `tagPool` 不能每轮 flatMap（竞态）。改为循环外算一次基础 tagPool；本条整理产出的新 tag 不影响后续条目（可接受，因为 AI 标签本来就有多样性）。
- **429 限流**：若 API 返回 429，当前直接计失败。批次 3 可顺手加 1 次指数退避重试（仅在 `response.status === 429` 时，等 1-2s 重试一次）。

### 6.4 验收
- 100 条链接整理时间从 ~200s 降到 ~50-60s；
- 进度条平滑推进；
- 中途停止能正确终止（不再发新请求）；
- 并发下不出现数据错乱（同一条链接不被处理两次）。

---

## 七、批次 4 — 结果预览/撤销

### 7.1 目标
整理完成后，不直接 `onUpdateLinks`，先弹预览，用户确认或逐条勾选后再应用；保留一份快照支持撤销。

### 7.2 改动

**a) 新增组件 `components/OrganizePreviewModal.tsx`**
- 接收 `{ changes: { linkId, before, after }[] }`。
- 展示表格：每行显示链接标题 + 变更字段（描述/分类/标签的 before→after，用颜色高亮）。
- 全选/反选 + 单条勾选。
- 「应用选中」「全部应用」「取消」。

**b) `SettingsModal.tsx`**
- 整理循环结束后，不立即 `onUpdateLinks`，而是 `setPendingChanges(changes)` 打开预览弹窗。
- 用户「应用」→ `onUpdateLinks(merged)` 并关闭；
- 用户「取消」→ 不写入（相当于撤销全部）。

**c) 撤销（可选增强）**
- 应用前存一份 `links` 快照到组件状态，提供「撤销本次整理」按钮（限时，比如应用后 30s 内可撤销）。

### 7.3 验收
- 整理完不立即落盘，弹出预览；
- 预览能正确显示 before/after；
- 取消后数据不变；
- 应用后数据正确写入。

---

## 八、全局注意事项

1. **受锁分类过滤保留**：所有批次的 `targetLinks` 过滤都保留 `!lockedCatIds.has(link.categoryId)`（#3 已修复的隐私保护），不能因新增逻辑而遗漏。
2. **脱敏日志规范**：所有 AI 相关 `console.error/warn` 遵循 #12b 规范，只记 `error.name` / `response.status` / raw 片段，不输出完整 prompt/response。
3. **向后兼容**：
   - 移除 Gemini 分支后，老的 Gemini provider 配置不会报错（走 OpenAI 兼容路径，但需要用户改 baseUrl）——**这是破坏性变更，需在升级说明里提示**。
   - `organizeLink` 新增的 `pageMeta` 参数为可选，旧调用方不传也能工作。
4. **打包体积**：批次 0 移除 Gemini SDK 后，`vendor-ai` 分包应消失，首屏体积下降。
5. **测试**：仓库无测试运行器，每批以 `tsc --noEmit` + `npm run build` + 手动验证为准。

---

## 九、回滚点

每批独立提交，回滚粒度为单批：
- 批次 0 回滚：`git revert <hash>` 即可恢复 Gemini 分支。
- 批次 1-4 回滚：均为独立函数/组件新增，revert 不影响其他批次。

---

## 十、未列入本计划（后续可选）

- **批量 prompt**（一次请求处理多个书签）：准确率与单条相当但成本更低，实现复杂（模型需返回数组并保持顺序对齐），作为批次 3 之后的高级优化。
- **整理范围按分类/标签筛选**：UI 增加下拉，选"只整理某分类"。属于功能拓展，非优化。
- **整理结果质量评分**：用第二次 AI 调用给整理结果打分，低分自动标红。成本高，优先级低。

---

## 附：实施顺序建议

如果时间有限，**只做批次 0 + 批次 1 + 批次 2** 即可获得最大收益（移除冗余 SDK + 抓 meta 提升准确率 + 修复静默失败），改动可控。批次 3（并发）和批次 4（预览）可在用户反馈"太慢/想撤销"后再做。
