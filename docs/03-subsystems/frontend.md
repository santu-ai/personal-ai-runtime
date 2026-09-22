# 前端子系统

本文档描述 React SPA（`frontend/`）。技术栈：React 19 + Vite 6 + TanStack Query 5 + Zustand 5 + Tailwind v4 + react-router-dom 7。

## 启动

[`frontend/src/main.tsx`](../../frontend/src/main.tsx)：

- 挂载 `<RouterProvider router={router} />` 包在 `QueryClientProvider` 内。
- `QueryClient` 默认：`staleTime 30s`、`refetchOnWindowFocus: false`、`retry: 1`。
- `import "./auth"` 在模块加载时跑 `initAuth()`。
- 生产模式注册 Service Worker `/sw.js`（桌面构建跳过）。API 与 WebSocket 为 network-only，不读写 Cache Storage；静态资源 cache-first，HTML network-first。`CACHE_VERSION` 变更会在 activate 时清掉旧缓存。Vitest 用 `src/sw.test.ts` 校验 API 请求不碰 Cache Storage（该文件与 `viteConfig.test.ts` 因 Node API 不纳入 `tsc --noEmit`）。

## 路由

[`frontend/src/router.tsx`](../../frontend/src/router.tsx) 用 `createBrowserRouter`，**所有页面组件懒加载**，嵌套在单个 `Layout` 下：

| Route | 页面文件 | 用途 |
|---|---|---|
| `/`（index） | `pages/ChatPage.tsx` | 聊天首页（无会话）→ `ChatHome` |
| `/chat/:conversationId` | `pages/ChatPage.tsx` | 活跃会话 → `ChatView` |
| `/goals` | `pages/Goals.tsx` | 目标列表 + 详情 |
| `/goals/:goalId` | `pages/Goals.tsx` | 目标详情 |
| `/tasks` | `pages/Tasks.tsx` | 后台/可执行任务列表，可创建项目资料简报 |
| `/tasks/:taskId` | `pages/Tasks.tsx` | 任务详情：交付结果优先，可验收/返工；执行日志可折叠 |
| `/inbox` | `pages/Inbox.tsx` | 未读分拣三列（重要 / 需跟进 / 可忽略）+ 最近 15 封（仅标题与发件人，未读加粗）+ 最近同步时间/结果/失败原因与重试 |
| `/memories` | `pages/Memories.tsx` | 记忆列表 + 图谱（含 `?tab=portrait` 画像、`?tab=review` 待确认 triage：筛选/批量确认拒绝） |
| `/dashboard` | `pages/Dashboard.tsx` | 「今天」工作台：三栏「需要你决定 / 今天要做 / AI 已处理」+ 近 7 日与前 7 日对比 + 无法进栏的导流提醒（`?tab=trust` 信任报告、`?tab=monitors` 收件箱/网页监控） |
| `/settings` | `pages/Settings.tsx` | LLM/邮件/MCP/数据设置 |
| `/approvals` | `pages/Approvals.tsx` | 审批队列 |
| `/timeline` | `pages/Timeline.tsx` | 人生事件时间线 |

## 认证

[`frontend/src/auth.ts`](../../frontend/src/auth.ts)：

**Token 解析顺序**：`import.meta.env.VITE_AUTH_TOKEN`（构建/env）→ `localStorage["auth_token"]` → 无。选中 token 在 React 挂载前经 `setAuthToken()` 推入 API client。`initAuth()` 在模块 import 时调用。

## API Client 分层

[`frontend/src/api/`](../../frontend/src/api/) 是分层结构：

```
core.ts        ← fetch 包装 + auth header + ApiError
   ↑
chat.ts, system.ts, workItems.ts, memory.ts, inbox.ts,
settings.ts, telemetry.ts, approvals.ts,
notifications.ts, portrait.ts, trustReport.ts
   ↑
client.ts      ← barrel 再导出
types.ts       ← 共享 TS 接口
```

### core.ts

[`frontend/src/api/core.ts`](../../frontend/src/api/core.ts)：

- `API_BASE = "/api"` — **始终相对**。开发经 Vite proxy；生产同源部署。
- Auth header：`Authorization: Bearer <token>`（仅当 token 设置）。
- 401 → 抛 `ApiError`（中文消息「认证失败，请检查 AUTH_TOKEN 与 VITE_AUTH_TOKEN 是否一致」）。
- `ApiError` 带 `.status` 字段。

### 前端如何到达后端

**开发模式** — Vite proxy（[`frontend/vite.config.ts`](../../frontend/vite.config.ts)）：

```
"/api" → http://${API_HOST}:${API_PORT}   (changeOrigin: true)
"/ws"  → http://${API_HOST}:${API_PORT}   (ws: true, changeOrigin: true)
```

`API_HOST`/`API_PORT` 来自 `process.env.VITE_API_HOST`/`VITE_API_PORT`（默认 `127.0.0.1`/`8000`）。配置从**仓库根** `.env`（`envDir: rootDir`）读取——与后端 `AUTH_TOKEN` 同一个文件。Dev server 默认绑 `127.0.0.1`（避免 Vite 同源代理把无认证 API 暴露到局域网）。仅当同时设置 `VITE_DEV_LAN=1` 与非空 `VITE_AUTH_TOKEN` 时才监听所有网卡。

**生产模式** — `API_BASE = "/api"` 相对，要求同源部署同时服务静态前端与 API。Docker Compose 用 Caddy 把 `/`、`/api/*`、`/ws` 挂在同一入口（见 [deployment.md](../05-engineering/deployment.md)）。

### SSE 聊天流

[`frontend/src/api/chat.ts:30-114`](../../frontend/src/api/chat.ts) 的 `sendMessage()` 开流式 POST，手动解析 SSE：

- 读 `data: ` 行，解码 JSON `StreamEvent`。
- 事件类型：`text_delta`、`tool_call_start`、`tool_result`、`confirmation_required`、`sources`、`done`、`error`、`ping`（跳过）。
- 30s 空闲超时中止 reader。
- Auth header 直接附加（不走 `request()`）。

## 状态管理

### Zustand stores（[`frontend/src/stores/`](../../frontend/src/stores/)）

- **`chatStore.ts`** — 全局聊天 UI 状态：`conversations`、`activeConversationId`、`pendingPrompt`（被 `useQuickChat` 用于播种新聊天）。
- **`errorStore.ts`** — 全局错误/toast 队列：`errors`（上限 5）、`backendUnavailable` 标志（`Layout` 初始健康检查失败时翻转）、`addError`/`dismissError`/`setBackendUnavailable`/`clearErrors`。`addError` 同时 `console.error`，方便在浏览器 / Electron DevTools 里对照右下角 toast。

### TanStack React Query

主要用于 server cache：

- `useDashboard`（[`hooks/useDashboard.ts:30-139`](../../frontend/src/hooks/useDashboard.ts)）— 7 个并行查询（`costSummary`/`costByModel`/`toolSummary`/`memoryStats`/`health`/`notifications`/`dashboard`），全部 `refetchInterval: 60_000`、`staleTime: 30_000`、`retry: 1`。
- `useMemoriesGroupedQuery`（[`hooks/useMemoriesQuery.ts`](../../frontend/src/hooks/useMemoriesQuery.ts)）— query key `["memories","grouped", filters]`，支持 `conversationId` / `source` 过滤当前会话 proposed；`staleTime: 10s`。
- 共享 query key 集中在 [`hooks/useWsInvalidationBridge.ts:13-19`](../../frontend/src/hooks/useWsInvalidationBridge.ts)：`memories`、`memoriesGrouped`、`goals`、`inbox`、`dashboard`。

### WebSocket 失效桥

[`hooks/useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts)：轻量 pub/sub。`useNotifications`（持有 WS）对每个合法 payload 调 `dispatchWsEvent(raw)`，桥订阅并失效 React Query cache：

- `memory_changed` → 失效 `memories` + `dashboard`
- `notification` → 失效 `dashboard`
- 其他类型忽略（显式 opt-in）

`Layout` 根挂载一次。

## 自定义 Hooks

| Hook | 文件 | 职责 |
|---|---|---|
| `useChatMessages` | [`useChatMessages.ts:139-334`](../../frontend/src/hooks/useChatMessages.ts) | 加载消息、管理流式状态、解析 tool calls/sources/inbox 摘要、驱动发送循环 |
| `useQuickChat` | [`useQuickChat.ts:13-33`](../../frontend/src/hooks/useQuickChat.ts) | 创建会话、导航到 `/chat/{id}`、可选设 pending prompt |
| `useApprovalFlow` | [`useApprovalFlow.ts:101-233`](../../frontend/src/hooks/useApprovalFlow.ts) | 管理待工具确认；inflight 审批去重；批准后续写若返回下一审批则立即展示 |
| `useNotifications` | [`useNotifications.ts`](../../frontend/src/hooks/useNotifications.ts) | 持有单 socket WebSocket；指数退避重连（封顶 60s，无次数上限）；`online` 与页面重新可见时立即重连；toast + 实时通知；每 payload 转发到失效桥 |
| `useWsInvalidationBridge` | [`useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts) | 见上 |
| `useDashboard` | [`useDashboard.ts`](../../frontend/src/hooks/useDashboard.ts) | 见上 |
| `useMemoriesGroupedQuery` | [`useMemoriesQuery.ts`](../../frontend/src/hooks/useMemoriesQuery.ts) | 见上 |

## 组件

[`frontend/src/components/`](../../frontend/src/components/)：

- **`ui/`** — 原语：`Button`、`Badge`、`Card`、`Dialog`、`EmptyState`、`ErrorBoundary`、`Input`（含 `PasswordInput`）、`Spinner`。每个有 co-located `.test.tsx`。
- **`layout/`** — `Sidebar.tsx`（聊天列表 + 导航，[`Sidebar.tsx:22-37`](../../frontend/src/components/layout/Sidebar.tsx)）、`NotificationBell.tsx`。
- **`chat/`** — `ChatView.tsx`（活跃会话；`ProposedMemoryBanner` 只展示当前会话 `source=conv:{id}` 的待确认记忆，toast 文案为「待确认」）、`ChatHome.tsx`（落地，横幅仍用全局 proposed 计数）、`MessageItem.tsx`、`ToolCallDisplay.tsx`、`ContextPanel.tsx`、`ConfirmationDialog.tsx`（审批模态；`needs_user` 写工具用「建议」话术；`ask_user` 展示问题与文本回答）、`VoiceInput.tsx`、`CodeBlock.tsx`（懒加载 `react-syntax-highlighter`）。
- **`dashboard/`** — `todayBuckets.ts` 纯前端分桶：需要你决定（待审批 / 待确认记忆 / important·actionable 邮件）、今天要做（3 日内截止或停滞目标）、AI 已处理（当日晨报 / 收件箱摘要 / 目标进展 / 可忽略邮件计数）。`AdoptionSummary` 在今日页展示近 7 日采纳率（工具建议确认 + 记忆确认，数据来自 `GET /api/telemetry/governance`），点击进入信任页。`PeriodComparison` 展示近 7 日与前 7 日的完成目标、完成任务、新邮件和采纳率（`GET /api/dashboard/periods`）。`RemindersPanel` 只保留 `reminder` / `url_monitor` / `morning_brief_failed`，先按 `related_id` 去重再截断。`morning_brief` 通知路由到 `/dashboard`。
- **`notifications/`** — `NotificationDetailModal.tsx`。
- **`onboarding/`** — `OnboardingWizard.tsx`（首次运行，`localStorage.onboarding_done` 门控）。

侧栏导航模型（[`Sidebar.tsx:22-37`](../../frontend/src/components/layout/Sidebar.tsx)）：

- `PRIMARY_NAV`：`/`「对话」
- `DATA_NAV`（折叠在「我的数据」组下）：`/memories`「记忆」（含画像 tab）、`/dashboard`「仪表盘」（含信任报告 tab）、`/goals`「目标」、`/inbox`「收件箱」、`/approvals`「审批」、`/timeline`「时间线」
- `SYSTEM_NAV`：`/settings`「设置」

会话列表只在 chat 路由显示。

## Layout

[`frontend/src/Layout.tsx`](../../frontend/src/Layout.tsx) 渲染：

1. `<Sidebar>`（左 256px）含会话列表 + 导航。
2. Banner 覆盖层：(a) 后端需认证但未配 token，(b) 后端不可用。
3. Toast 栈（右上）：WS 实时通知 + `useErrorStore` 错误 toast。
4. `<main>` 含 `<Suspense>` + `<ErrorBoundary>` 包 `<Outlet />`。
5. 对话框：删除会话确认、`OnboardingWizard`、`NotificationDetailModal`。

Layout 在根处挂三个副作用 hook：`useNotifications()`（唯一持有 WS）、`useWsInvalidationBridge()`、会话/健康查询。仪表盘经 `LiveNotificationContext` 消费实时通知，不再自开第二条 socket。

## 构建 / 开发 / 测试

### Scripts（[`frontend/package.json:6-14`](../../frontend/package.json)）

| Script | 命令 |
|---|---|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `preview` | `vite preview` |
| `test` | `vitest run` |
| `test:e2e` | `playwright test` |
| `lint` | `eslint src/ && prettier --check src/` |
| `format` | `prettier --write src/` |

### Vite 配置

[`frontend/vite.config.ts`](../../frontend/vite.config.ts)：

- 插件：`@vitejs/plugin-react`、`@tailwindcss/vite`。
- `envDir: rootDir` — 仓库根 `.env` 是 `VITE_API_HOST`/`VITE_API_PORT`/`VITE_AUTH_TOKEN` 源。
- Dev server 默认绑 `127.0.0.1:5173`；`VITE_DEV_LAN=1` 且 `VITE_AUTH_TOKEN` 非空时才 `host: true`。proxy `/api` 与 `/ws`（`ws: true`）。
- `define`：`__API_HOST__`、`__API_PORT__`（声明于 [`vite-env.d.ts:11-12`](../../frontend/src/vite-env.d.ts)）。
- 生产 `manualChunks`：分离 `vendor-markdown`、`vendor-react`、`vendor-icons`、通用 `vendor`、每页 chunk（`page-{name}`）。

### TypeScript

[`frontend/tsconfig.json`](../../frontend/tsconfig.json)：ES2020、bundler 解析、`jsx: react-jsx`、strict、`noEmit`、`forceConsistentCasingInFileNames`。`noUnusedLocals/Parameters` **关闭**。

### ESLint

[`frontend/eslint.config.js`](../../frontend/eslint.config.js)：Flat config，`@eslint/js` recommended + `typescript-eslint` recommended。忽略 `dist/`、`node_modules/`、`test-results/`。自定义：`no-unused-vars` warn（`_` 参量忽略）、`no-explicit-any` warn。

### Vitest

[`frontend/vitest.config.ts`](../../frontend/vitest.config.ts)：jsdom、包含 `src/**/*.test.{ts,tsx}`、setup 文件 [`src/test/setup.ts`](../../frontend/src/test/setup.ts)（注册 `@testing-library/jest-dom` + 每测 cleanup）。定义 `__API_HOST__`/`__API_PORT__`。

### Playwright

[`frontend/playwright.config.ts`](../../frontend/playwright.config.ts)：`testDir: "./e2e"`、60s 超时、headless、baseURL `http://localhost:5173`。`webServer.command: "npm run dev"`，复用已存在 server，120s 超时。

e2e 文件：[`e2e/chat-approval.spec.ts`](../../frontend/e2e/chat-approval.spec.ts)、[`e2e/extra-flows.spec.ts`](../../frontend/e2e/extra-flows.spec.ts)、[`e2e/trust-loops.spec.ts`](../../frontend/e2e/trust-loops.spec.ts)、[`e2e/real-backend.spec.ts`](../../frontend/e2e/real-backend.spec.ts)，配合 [`e2e/helpers.ts`](../../frontend/e2e/helpers.ts) 的 `MockApiRouter`。mock 套件覆盖导航、聊天发送、审批确认/拒绝流、连续二次确认、首页发送、审批重载恢复、收件箱重试同步、proposed 确认进上下文、仪表盘错误态、时间线、仪表盘数据主权面板；`real-backend.spec.ts` 走真实后端 + fake LLM。

### 单元测试

- Vitest：`auth.test.ts`、`api/client.test.ts`，组件测试 `Button/Input/Dialog/Sidebar/MessageItem/ToolCallDisplay/ContextPanel/ConfirmationDialog/ChatView/ui.snapshots`，页面测试 `Dashboard/Inbox/Memories/Goals/Settings/Portrait/TrustReport`。strip/tool-label 工具也有测试。

## 工具

[`frontend/src/utils/`](../../frontend/src/utils/)：

- `stripToolMarkup.ts` — 去除助手文本中的内联工具调用标记（带测试）。
- `timeUtils.ts` — `timeAgo`、`isStagnant`（Goals 用）。
- `toolLabels.ts` / `toolLabels.test.ts` — 工具名友好中文标签。
- `notificationRoutes.ts` — 通知类型 → 路由 + 标签。
- `notificationUtils.ts` — `notificationPreview`（截断）。
