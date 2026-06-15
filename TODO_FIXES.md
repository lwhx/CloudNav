# CloudNav 待修复问题清单

> 本文档记录经两轮安全/正确性审计后**仍未修复**的问题。已完成的两轮修复见 git 历史。
> 每项包含：位置、严重度、根因、建议修复方案。按修复优先级排序。

---

## 一、需要修复（明确 bug，改动小）

### 1. SortableLinkCard 缺失 props 导致详细视图排序时布局错乱
- **文件**：`App.tsx:1366`、`App.tsx:1537`
- **严重度**：Medium（新发现）
- **根因**：两处 `React.createElement(SortableLinkCard, { key, link })` 只传了 `key` 和 `link`，但 `SortableLinkCard`（`components/links/SortableLinkCard.tsx:12`）解构了 `siteSettings`、`isSortingMode`、`isSortingPinned`，全部为 `undefined`。后果：
  - `siteSettings.cardStyle === 'detailed'` 永远为 false → 详细卡片样式失效，始终渲染精简视图
  - `isSortingMode || isSortingPinned` 永远为 false → 排序时的绿色高亮样式不显示
- **修复**：两个调用点补传：
  ```js
  React.createElement(SortableLinkCard, { key: link.id, link, siteSettings, isSortingMode, isSortingPinned })
  ```
  注意 `siteSettings`/`isSortingMode`/`isSortingPinned` 需在 App.tsx 作用域内可见（检查是否已定义/导入）。

---

### 2. #8 AI baseUrl 无协议校验，可外泄 API Key
- **文件**：`services/geminiService.ts:53-75`（`callOpenAICompatible`）
- **严重度**：Medium（凭据外泄）
- **根因**：`provider.baseUrl` 直接拼接成 fetch URL，无协议校验。用户若导入恶意配置（`baseUrl: "http://attacker/v1"`），`Authorization: Bearer <apiKey>` 会发到攻击者服务器。另外 line 56-59 的 `if (!baseUrl.includes('/chat/completions'))` 分支是死代码（if/else 两边都追加相同后缀）。
- **修复**：fetch 前校验 `new URL(baseUrl).protocol === 'https:'`；允许 `http:` 仅当 hostname 为 `localhost`/`127.0.0.1`（本地 LLM）。同时合并冗余的 if/else 分支。

---

### 3. #9 批量 AI 整理把受密码保护分类的链接发给第三方 LLM
- **文件**：`components/SettingsModal.tsx:280`
- **严重度**：Medium（隐私外泄）
- **根因**：`handleSuggestCategories` / 批量整理构建 `activeLinks = links.filter(link => !link.deletedAt)`，**未过滤** `categoryId` 属于带 `password` 的分类。这些链接的 title/url/description/tags 会被发到 Gemini/OpenAI。
- **修复**：构建 prompt 前排除受锁分类：
  ```js
  const lockedCatIds = new Set(categories.filter(c => c.password && !c.deletedAt).map(c => c.id));
  const activeLinks = links.filter(link => !link.deletedAt && !lockedCatIds.has(link.categoryId));
  ```
  注意：分类锁目前是**客户端验证**（见第六节架构问题），所以这个过滤是"尽力而为"——如果后续做了服务端化，应在服务端也过滤。

---

### 4. #29 限流可经 `x-forwarded-for` 伪造绕过
- **文件**：`functions/api/storage-shared.ts:228-232`（`getClientIdentifier`）
- **严重度**：Medium（在 Cloudflare 环境下影响有限）
- **根因**：客户端标识回退到 `request.headers.get('x-forwarded-for')`，该头**客户端可伪造**。Cloudflare 正常设置 `cf-connecting-ip`（边缘可信），但若 `cf-connecting-ip` 缺失（路由配置错误、源站直连、开发环境），攻击者可轮换 `x-forwarded-for` 绕过限流。
- **修复**：仅信任 `cf-connecting-ip`；缺失时归入单一 "unknown" 桶（不要用可伪造头）：
  ```js
  return request.headers.get('cf-connecting-ip') || 'unknown-peer';
  ```

---

### 5. #5 WebDAV catch 块泄露内部端点信息
- **文件**：`functions/api/webdav.ts:166-167`
- **严重度**：Low（信息泄露）
- **根因**：catch 块返回 `error.message` 原文，DNS/TLS 错误信息可能含 Worker 尝试访问的内部主机名/IP（与 SSRF #4 叠加时尤其危险）。success 路径已用 `buildWebDavErrorMessage` 做了友好映射，但 catch 没有。
- **修复**：catch 块只返回通用消息：
  ```js
  return buildJsonResponse({ success: false, error: 'WebDAV 请求失败，请检查网络或配置' }, 500, corsHeaders);
  ```
  原始错误 `console.log` 到服务端日志即可。

---

### 6. #6 WebDAV filename 路径注入
- **文件**：`functions/api/webdav.ts:70`
- **严重度**：Low（已认证用户，影响有限）
- **根因**：`encodeURIComponent(finalFilename).replace(/%2F/gi, '/')` —— encode 后又把 `/` 放回，等价于没对路径分隔符做防护。含 `../` 的 filename 可在 WebDAV 服务器上路径穿越。
- **修复**：若不需要子路径，直接 `encodeURIComponent(finalFilename)` 不要 replace；若需要子路径，校验解析后路径仍在 `baseUrl` 根目录下。

---

## 二、需要修复（明确 bug，需确认产品决策）

### 7. #4 WebDAV SSRF（post-auth）
- **文件**：`functions/api/webdav.ts:139-144`
- **严重度**：High（凭据后 SSRF）
- **根因**：`config.url` 用户可控，**完全不经过** `isBlockedHostname`/`isPrivateIPv4` 校验，直接进入 `fetch(webDavRequest.fetchUrl, ...)`。鉴权用户（或任何知道主密码的人）可让 Worker 访问 `http://169.254.169.254/`（云元数据）、`http://127.0.0.1:port/`、内网主机。状态码会回显给攻击者，可用于内部端口扫描。
- **修复**：在 `buildWebDavRequest` 之前解析 `config.url`，拒绝非 http(s) 协议、非标准端口、私网/链路本地 IP、`.internal`/`.local` 等。复用 `storage-shared.ts` 的 `isBlockedHostname`/`normalizeMetadataUrl`。
- **注意权衡**：有些用户把 WebDAV 部署在内网（Nextcloud 等），校验可能误伤。建议做成可配置的允许列表，或至少拦截已知元数据地址和环回地址。

---

### 8. #10 CORS 允许任意 chrome-extension/moz-extension origin
- **文件**：`functions/api/storage-shared.ts:39-43`（`getCorsHeaders`）
- **严重度**：Medium
- **根因**：`origin.startsWith('chrome-extension://')` 允许**任何**已安装扩展发起带凭据请求并读取响应。恶意扩展（配合 #13 扩展模板泄露的主密码）可完整读取用户数据。
- **修复**：绑定到具体的 extension ID。可在 `website_config` 增加 `allowedExtensionIds` 字段，CORS 校验时检查 `origin` 是否匹配允许列表。无配置时拒绝扩展来源（仅允许同源）。
- **权衡**：需要用户在设置里填自己的 extension ID，体验略降。或保留宽松策略但文档明确风险。

---

## 三、需要修复（架构级，工作量大）

### 9. #13 扩展模板内嵌明文主密码
- **文件**：`components/SettingsModal.tsx:402-403`、`:730-731`、`:1005-1006`
- **严重度**：High
- **根因**：生成的浏览器扩展源码（`background.js`/`sidebar.js`/`popup.js`）把主密码硬编码进 `CONFIG.password = "${password}"`，`password` 来自 `localStorage['cloudnav_auth_token']`（即原始主密码）。下载的 ZIP / 可复制的代码块含明文密码，持久留在磁盘。
- **修复**：不在源码里嵌密码。改为扩展首次运行时弹出输入框，存入 `chrome.storage.local`。生成模板时只放占位符，运行时从 storage 读。
- **工作量**：中等（需改 3 个模板字符串 + 扩展首次运行流程）。

---

### 10. #20/#21 主密码明文存 localStorage + 非恒定时间比较
- **文件**：`hooks/useAuthSession.ts:3`（存储）、`functions/api/storage-shared.ts:89`（比较）
- **严重度**：High（设计缺陷）
- **根因**：
  - 客户端把**原始主密码**存入 `localStorage['cloudnav_auth_token']`，每次请求作为 `x-auth-password` 头发送。XSS/扩展/共享机器可读。
  - 服务端用 `providedPassword !== serverPassword`（短路比较），理论上可时序攻击（Cloudflare 边缘抖动大，实际难度高）。
- **修复**：引入会话令牌机制：
  1. 登录时服务端验证密码后签发一个随机/HMAC 令牌（带过期），存 KV（key=session:<token>）
  2. 客户端只存令牌，请求带 `Authorization: Bearer <token>`
  3. 服务端用恒定时间比较令牌
  4. 令牌可吊销、有过期、不暴露原始密码
- **工作量**：大（需改鉴权协议、迁移现有会话、所有受保护端点）。建议作为独立 PR。

---

### 11. 分类密码锁仅客户端验证（API 明文返回受锁数据）
- **文件**：`functions/api/storage.ts:161-178`（GET 返回完整 app_data）、`components/CategoryAuthModal.tsx:20`（客户端 `password === category.password`）
- **严重度**：High（功能性失效——"分类密码"提供的是错觉而非保护）
- **根因**：API 把所有链接（含受锁分类的）+ 分类密码（明文）一起返回客户端。锁只在 React 渲染层过滤。开 DevTools / 直接调 API 即可看到全部受锁内容。
- **修复**：
  - 服务端 GET 时按 header 里的"已解锁分类凭证"过滤：未提供正确分类密码的分类，其链接不返回
  - `Category.password` 存哈希（bcrypt/argon2 在 Workers 不可用，可用 PBKDF2 via WebCrypto），明文不入 KV
  - 验证改服务端
- **权衡**：这是"是否真要保护分类内容"的产品决策。若只是 UI 遮挡用途，应在 UI 明确标注"仅遮挡，非安全边界"。

---

## 四、小改进（Low）

### 12. #12b AI console.error 泄露完整错误/prompt 数据
- **文件**：`services/geminiService.ts:79, 86, 115, 148, 210, 277`
- **严重度**：Low（仅客户端控制台）
- **根因**：`console.error("OpenAI API Error:", err)` 等日志输出完整 `response.text()` 或错误对象。某些网关在错误体里回显请求头（含 `Authorization: Bearer <key>`）；prompt 数据（用户书签 title/url）也可能进错误对象。
- **修复**：只记 `response.status` 和简短消息，不输出 `response.text()` 全文或完整 error 对象。

---

### 13. #8b handleLogin 用过期闭包里的 siteSettings 判断 expiry
- **文件**：`App.tsx:343-360`
- **严重度**：Low
- **根因**：`handleLogin` 内 `fetch` 拿到最新 `websiteConfig` 后调 `setSiteSettings`（异步），但紧接着的过期检查用的是闭包里**旧的** `siteSettings.passwordExpiryDays`。若管理员在云端改了过期天数，本次登录仍按旧值判断。
- **修复**：在 fetch success 块内用 `websiteConfigData.passwordExpiryDays` 局部变量做判断，不依赖 `siteSettings`。

---

### 14. ImportModal 分类去重仅按 name，id 冲突时静默丢弃
- **文件**：`components/ImportModal.tsx:130-132, 174-192` + `App.tsx:427-431`
- **严重度**：Low（预览计数不准 + 部分分类消失）
- **根因**：去重按 `name`，但若导入分类与现有分类 `id` 相同 `name` 不同，ImportModal 会保留它，`handleImportConfirm` 又按 `c.id === nc.id` 过滤掉 → 用户期待的分类消失，预览计数虚高。
- **修复**：去重同时按 `id` 和 `name`；冲突时为新分类重新生成 id。

---

### 15. TrashModal 可永久删除 'common' 分类
- **文件**：`components/TrashModal.tsx:63-66`（`permanentlyDeleteCategory`）
- **严重度**：Low
- **根因**：软删除 `handleDeleteCategory` 保护了 `common`（`useCategoryAccess.ts:62-65`），但**永久删除**没有同样保护。删掉 `common` 后，restore 落到 `common` 的链接会变隐形。
- **修复**：`permanentlyDeleteCategory` 拒绝删除 `id === 'common'` 的分类。

---

## 五、已知限制（非 bug，记录在案）

### A. #2 并发写丢失（KV 无 CAS）
- **位置**：`functions/api/link.ts:127-148` + `functions/api/storage.ts:303`
- **说明**：两个端点都是非原子 read-modify-write。单用户自托管场景概率极低，且客户端 `mergeAppData` 合并能恢复大部分丢失。完整修复需 Durable Objects 做单飞写入队列。
- **当前缓解**：link id 改用 UUID 避免碰撞；防御性 JSON.parse。

### B. #3 search 配置无鉴权读取
- **决策**：保持公开。search_config 只含公开搜索引擎 URL（无密钥），且需在未登录时加载（与 website 配置一致）。已在前次报告标注。

---

## 修复优先级建议

1. **立即修（小改动、明确收益）**：#1 SortableLinkCard props、#8 AI baseUrl 校验、#9 AI 受锁过滤、#29 限流、#5/#6 WebDAV 错误/路径
2. **本轮一并修（需权衡）**：#4 WebDAV SSRF、#10 CORS
3. **独立 PR（架构级）**：#13 扩展密码、#20/#21 会话令牌、#11 分类锁服务端化
4. **小改进（随手）**：#12b、#8b、ImportModal、TrashModal

---

## 已完成修复（两轮，共 21 项，供对照）

数据完整性：编辑链接 id 清空、loadLinkIcons 覆盖编辑、handleOnline 覆盖 pending、link.ts 容错、saveLocalAppData quota 处理、ID 碰撞(UUID)、bookmarklet 弹窗、置顶排序方向、批量选择泄漏、回归2处
安全：会话过期绕过、authenticatedAt 不刷新、expiryDays||7、IPv6 v4-mapped SSRF、SVG favicon XSS、导出 URL 转义、导入危险协议、标题 decode-strip 顺序、getWebsiteConfig 容错、嵌套文件夹归类
