# 前端子系统

本文档描述 React SPA（`frontend/`）。技术栈：React 19 + Vite 8 + TanStack Query 5 + Zustand 5 + Tailwind v4 + react-router-dom 7。版本以 [`frontend/package.json`](../../frontend/package.json) 为准。

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
| `/goals` | `pages/Goals.tsx` | 目标列表 + 详情。与其他主页面共用 `page-shell`；窄屏选中后只显示详情，可返回列表。进度经 `goalProgressPercent`：0–1 乘 100；大于 1 视为已经是百分比，显示不超过 100 |
| `/goals/:goalId` | `pages/Goals.tsx` | 同上，直接打开该目标详情 |
| `/tasks` | `pages/Tasks.tsx` | 任务列表 + 详情。与目标页共用 `page-shell`；窄屏选中后只显示详情，可返回列表。列表分「进行中」「历史」：失败且带 `executable_plan`、且不是简报待办的任务留在「进行中」，行上标「可重新执行」；没有计划的失败、已完成和已取消在「历史」。可创建项目资料简报。有评审或已转任务时展示近 30 日首版采纳、返工、已转任务和平均评审耗时，以及按交付执行归因的审批次数、恢复次数和模型成本（已归因金额照常显示；另有未归因简报调用时标出其金额和次数，例如 `模型成本 $0.0000 · 未归因 $1.5000（1 次）`。读上限打满、接口值为 unavailable 时仍显示「未分开计」） |
| `/tasks/:taskId` | `pages/Tasks.tsx` | 同上，直接打开该任务详情：交付结果优先，可验收/返工；执行日志可折叠。日志里的 handler 行优先显示调度执行已有的 `error`（超时、死信或重试原因）；该字段为空白时，显示同一次 `ExecuteRequested` 引起的 `ExecuteCompleted.error`（计划内部失败，handler 正常返回：异常文本，或工具步骤 failed/denied 时步骤结果里已有的原因）。空字符串不显示。状态为 failed，或仍为 running 且最新 handler 已失败或死信时，主按钮显示「重新执行」。这两种情况下，非空白的 `handler_execution.error` 显示在对应提示旁边；已有交付、执行日志默认折叠时，显示在交付区上方。日志展开后仍显示同一段原文。验收可以填写可选说明，留空不传理由。「已验收」和「已要求返工」的版本在交付区显示该版本非空的 `latest_decision.reason`（空白不显示），版本历史同一行也写出。有上一版时，交付区显示「相对 vN」：用该版已存储的 findings、sources、limitations、suggested_actions，以及摘要、正文是否变化，对照 `supersedes_delivery_id` 指向的版本现算，不新增事件，也不把上一版全文放进对比结果。第一版或找不到上一版时该字段为 null，不显示这段。结论、限制或待办已有条目差异时，不再另写「正文已更新」；只有正文变了而上述条目没变时才写。交付区列出该版本已存储的 `checks`：`pass` 显示为通过，`fail` 为未通过，`needs_review` 为待判断；非空 `detail` 写在同一行（程序生成的英文说明换成中文，其它原文保留）。没有检查，或条目去掉空白后没有要求、结果和说明时，不显示这段。版本历史同一行写出这三类结果的条数；未通过和待判断带上对应 `criterion`。全部通过时只写通过条数。其它非空结果按原文计数。当前版来自详情里的交付包，历史全文来自单版本读取，字段相同。已完成且已有交付的项目简报可以「再次运行」：仍是这一份任务，不记返工；新版本沿用 `changes_from_previous` 对照当前交付。同一状态下可以「定时再次运行」：填写小时或分钟后，用既有 `set_timer` 把这一份的 `work_id` 写入定时 payload。到点再次运行或打开同一份任务，不另建简报 |
| `/inbox` | `pages/Inbox.tsx` | 未读分拣三列（重要 / 需跟进 / 可忽略）+ 最近 15 封（仅标题与发件人，未读加粗）+ 最近同步时间/结果/失败原因与重试 |
| `/memories` | `pages/Memories.tsx` | 记忆列表 + 图谱（含 `?tab=portrait` 画像、`?tab=review` 待确认 triage：筛选/批量确认拒绝） |
| `/dashboard` | `pages/Dashboard.tsx` | 「今天」工作台：三栏「需要你决定 / 今天要做 / AI 已处理」+ 近 7 日建议采纳 + 近 7 日与前 7 日对比 + 无法进栏的导流提醒（`?tab=trust` 信任报告、`?tab=monitors` 收件箱/网页监控）。「执行」面板除最近失败外，还列出 `failed` 里其余失败（最新在前），跳过与最近失败相同的 `id`，以及已在死信列表中的 `id`。最近失败、其余失败、重试中与死信仅在读模型已有 `work_id` 时链到 `/tasks/:id`；没有该字段的行保持纯文本，`correlation_id` 不当作任务 id。同一条执行（相同 `id`）不会在最近失败、其余失败和死信里重复出现。重试中的错误写在行内。有活动定时任务，或有已完成且已有交付的项目简报时，显示「定时」：定时行只在 payload 里已有 `work_id`（没有该键时用 `action_id`）且任务仍在时链到 `/tasks/:id`，否则纯文本；定时器 id 与 `correlation_id` 不当作任务 id。同一份简报链到该任务，再次运行后的新版本对照当前交付。带 `related_type=work_item` 的提醒在详情里打开 `/tasks/:id` |
| `/settings` | `pages/Settings.tsx` | LLM/邮件/MCP/数据设置 |
| `/approvals` | `pages/Approvals.tsx` | 审批队列。`ask_user` 必须先填写文本再「发送回答」，经 chat resolve 续写同一工具环；取消不带回答 |
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
notifications.ts, portrait.ts, trustReport.ts,
connectors.ts, monitors.ts, timeline.ts
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

[`frontend/src/api/chat.ts`](../../frontend/src/api/chat.ts) 的 `sendMessage()` 开流式 POST，手动解析 SSE：

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

- `useDashboard`（[`hooks/useDashboard.ts`](../../frontend/src/hooks/useDashboard.ts)）— 7 个并行查询（`costSummary`/`costByModel`/`toolSummary`/`memoryStats`/`health`/`notifications`/`dashboard`），全部 `refetchInterval: 60_000`、`staleTime: 30_000`、`retry: 1`。建议采纳与周期对比是页面上另两个查询，不在这 7 个里面。
- `useMemoriesGroupedQuery`（[`hooks/useMemoriesQuery.ts`](../../frontend/src/hooks/useMemoriesQuery.ts)）— query key `["memories","grouped", filters]`，支持 `conversationId` / `source` 过滤当前会话 proposed；`staleTime: 10s`。
- 共享 query key 集中在 [`hooks/useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts) 的 `queryKeys`：`memories`、`memoriesGrouped`、`goals`、`tasks`、`inbox`、`dashboard`、`trustReport`、`approvals`、`timeline`、`conversations`、`notifications`、`governance`，以及 settings / portrait / mcp 相关键。

### WebSocket 失效桥

[`hooks/useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts)：轻量 pub/sub。`useNotifications`（持有 WS）对每个合法 payload 调 `dispatchWsEvent(raw)`，桥订阅并失效 React Query cache：

- `memory_changed` → 失效 `memories`、`dashboard`、`portrait`、`trustReport`、`timeline`、`governance`
- `goal_changed` → 失效 `goals`、`tasks`、`dashboard`、`timeline`、`trustReport`、`portrait`
- `approval_changed` → 失效 `approvals`、`tasks`、`trustReport`、`dashboard`、`governance`（今日采纳卡跟着刷新）
- `notification` → 失效 `notifications`、`dashboard`、`trustReport`；类型名含 inbox/email 时再失效 `inbox`，含 goal 时再失效 `goals`
- 其他 `type` 忽略

`Layout` 根挂载一次。

## 自定义 Hooks

| Hook | 文件 | 职责 |
|---|---|---|
| `useChatMessages` | [`useChatMessages.ts`](../../frontend/src/hooks/useChatMessages.ts) | 加载消息、管理流式状态、解析 tool calls/sources/inbox 摘要、驱动发送循环 |
| `useQuickChat` | [`useQuickChat.ts`](../../frontend/src/hooks/useQuickChat.ts) | 创建会话、导航到 `/chat/{id}`、可选设 pending prompt |
| `useApprovalFlow` | [`useApprovalFlow.ts`](../../frontend/src/hooks/useApprovalFlow.ts) | 管理待工具确认；inflight 审批去重；批准后续写若返回下一审批则立即展示 |
| `useNotifications` | [`useNotifications.ts`](../../frontend/src/hooks/useNotifications.ts) | 持有单 socket WebSocket；指数退避重连（封顶 60s，无次数上限）；`online` 与页面重新可见时立即重连；toast + 实时通知；每 payload 转发到失效桥 |
| `useWsInvalidationBridge` | [`useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts) | 见上 |
| `useDashboard` | [`useDashboard.ts`](../../frontend/src/hooks/useDashboard.ts) | 见上 |
| `useMemoriesGroupedQuery` | [`useMemoriesQuery.ts`](../../frontend/src/hooks/useMemoriesQuery.ts) | 见上 |

## 组件

[`frontend/src/components/`](../../frontend/src/components/)：

- **`ui/`** — 原语：`Button`、`Badge`、`Card`、`Dialog`、`EmptyState`、`ErrorBoundary`、`Input`（含 `PasswordInput`）、`Spinner`。每个有 co-located `.test.tsx`。
- **`layout/`** — `Sidebar.tsx`（聊天列表 + 导航，[`Sidebar.tsx`](../../frontend/src/components/layout/Sidebar.tsx)）、`NotificationBell.tsx`。
- **`chat/`** — `ChatView.tsx`（活跃会话；`ProposedMemoryBanner` 只展示当前会话 `source=conv:{id}` 的待确认记忆，toast 文案为「待确认」）、`ChatHome.tsx`（落地，横幅仍用全局 proposed 计数）、`MessageItem.tsx`、`ToolCallDisplay.tsx`、`ContextPanel.tsx`、`ConfirmationDialog.tsx`（审批模态；`needs_user` 写工具用「建议」话术；`ask_user` 展示问题与文本回答）、`VoiceInput.tsx`、`CodeBlock.tsx`（懒加载 `react-syntax-highlighter`）。
- **`dashboard/`** — `todayBuckets.ts` 纯前端分桶：需要你决定（待审批 / 待确认记忆 / important·actionable 邮件）、今天要做（3 日内截止或停滞目标）、AI 已处理（当日晨报 / 收件箱摘要 / 目标进展 / 可忽略邮件计数）。`AdoptionSummary` 在今日页展示近 7 日采纳率（工具建议确认 + 记忆确认，数据来自 `GET /api/telemetry/governance`），点击进入信任页。`PeriodComparison` 展示近 7 日与前 7 日的完成目标、完成任务、新邮件和采纳率（`GET /api/dashboard/periods`）；`work_completed_untyped` 只在非零时出现。`RemindersPanel` 只保留 `reminder` / `url_monitor` / `morning_brief_failed`，先按 `related_id` 去重再截断。`morning_brief` 通知路由到 `/dashboard`。
- **`notifications/`** — `NotificationDetailModal.tsx`。
- **`onboarding/`** — `OnboardingWizard.tsx`（首次运行，`localStorage.onboarding_done` 门控）。

侧栏导航模型（[`Sidebar.tsx`](../../frontend/src/components/layout/Sidebar.tsx)）：

- 分组「概览」：`/`「对话」、`/dashboard`「概览」
- 分组「任务」：`/goals`「目标」、`/tasks`「任务」、`/inbox`「收件箱」、`/approvals`「审批」（角标：收件箱未读、待审批）
- 分组「知识」：`/memories`「记忆」、`/timeline`「时间线」。待确认记忆角标大于 0 时，「记忆」链到 `/memories?tab=review`
- 分组「系统」：`/settings`「设置」；底部通知铃
- 侧栏可收起（`localStorage.sidebar_collapsed`）；会话列表只在 chat 路由且展开时显示。视口窄于 `md`（768px）时强制保持图标栏宽度，不改已保存的收起偏好，避免主内容被 240px 侧栏挤没

## Layout

[`frontend/src/Layout.tsx`](../../frontend/src/Layout.tsx) 渲染：

1. `<Sidebar>`（展开 240px / 收起或窄屏 68px）含会话列表 + 导航。
2. Banner 覆盖层：(a) 后端需认证但未配 token，(b) 后端不可用。
3. Toast 栈（右上）：WS 实时通知 + `useErrorStore` 错误 toast。
4. `<main>` 含 `<Suspense>` + `<ErrorBoundary>` 包 `<Outlet />`。
5. 对话框：删除会话确认、`OnboardingWizard`、`NotificationDetailModal`。

Layout 在根处挂三个副作用 hook：`useNotifications()`（唯一持有 WS）、`useWsInvalidationBridge()`、会话/健康查询。仪表盘经 `LiveNotificationContext` 消费实时通知，不再自开第二条 socket。

## 构建 / 开发 / 测试

### Scripts（[`frontend/package.json`](../../frontend/package.json)）

| Script | 命令 |
|---|---|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `preview` | `vite preview` |
| `test` | `vitest run` |
| `test:e2e` | `playwright test` |
| `test:e2e:real` | `playwright test --config=playwright.real.config.ts` |
| `lint` | `eslint src/ && prettier --check src/` |
| `format` | `prettier --write src/` |

### Vite 配置

[`frontend/vite.config.ts`](../../frontend/vite.config.ts)：

- 插件：`@vitejs/plugin-react`、`@tailwindcss/vite`。
- `envDir: rootDir` — 仓库根 `.env` 是 `VITE_API_HOST`/`VITE_API_PORT`/`VITE_AUTH_TOKEN` 源。
- Dev server 默认绑 `127.0.0.1:5173`；`VITE_DEV_LAN=1` 且 `VITE_AUTH_TOKEN` 非空时才 `host: true`。proxy `/api` 与 `/ws`（`ws: true`）。
- `define`：`__API_HOST__`、`__API_PORT__`（声明于 [`vite-env.d.ts`](../../frontend/src/vite-env.d.ts)）。
- 生产 `manualChunks`：分离 `vendor-markdown`、`vendor-react`、`vendor-icons`、通用 `vendor`、每页 chunk（`page-{name}`）。

### TypeScript

[`frontend/tsconfig.json`](../../frontend/tsconfig.json)：ES2020、bundler 解析、`jsx: react-jsx`、strict、`noEmit`、`forceConsistentCasingInFileNames`。`noUnusedLocals/Parameters` **关闭**。

### ESLint

[`frontend/eslint.config.js`](../../frontend/eslint.config.js)：Flat config，`@eslint/js` recommended + `typescript-eslint` recommended。忽略 `dist/`、`node_modules/`、`test-results/`。自定义：`no-unused-vars` warn（`_` 参量忽略）、`no-explicit-any` warn。

### Vitest

[`frontend/vitest.config.ts`](../../frontend/vitest.config.ts)：jsdom、包含 `src/**/*.test.{ts,tsx}`、setup 文件 [`src/test/setup.ts`](../../frontend/src/test/setup.ts)（注册 `@testing-library/jest-dom` + 每测 cleanup）。定义 `__API_HOST__`/`__API_PORT__`。

### Playwright

[`frontend/playwright.config.ts`](../../frontend/playwright.config.ts)：`testDir: "./e2e"`、60s 超时、headless、baseURL `http://localhost:5173`。`webServer.command: "npm run dev"`，复用已存在 server，120s 超时。

e2e 文件：[`e2e/chat-approval.spec.ts`](../../frontend/e2e/chat-approval.spec.ts)、[`e2e/extra-flows.spec.ts`](../../frontend/e2e/extra-flows.spec.ts)、[`e2e/trust-loops.spec.ts`](../../frontend/e2e/trust-loops.spec.ts)、[`e2e/real-backend.spec.ts`](../../frontend/e2e/real-backend.spec.ts)，配合 [`e2e/helpers.ts`](../../frontend/e2e/helpers.ts) 的 `MockApiRouter`。mock 套件覆盖导航、聊天发送、审批确认/拒绝流、`ask_user` 文本回答与取消、连续二次确认、首页发送、审批重载恢复、收件箱重试同步、proposed 确认进上下文、今日周期对比、仪表盘错误态、时间线、仪表盘数据主权面板；`real-backend.spec.ts` 走真实后端 + fake LLM。默认 `playwright.config.ts` 忽略 `real-backend.spec.ts`。

### 单元测试

- Vitest：`auth.test.ts`、`api/client.test.ts`，组件测试 `Button/Input/Dialog/Sidebar/MessageItem/ToolCallDisplay/ContextPanel/ConfirmationDialog/ChatView/AdoptionSummary/PeriodComparison/ui.snapshots`，页面测试 `Dashboard/Inbox/Memories/Goals/Tasks/Approvals/Timeline/Settings/Portrait/TrustReport/ChatPage`。strip/tool-label 工具也有测试。

## 工具

[`frontend/src/utils/`](../../frontend/src/utils/)：

- `stripToolMarkup.ts` — 去除助手文本中的内联工具调用标记（带测试）。
- `timeUtils.ts` — `timeAgo`、`isStagnant`（Goals 用）。
- `goalProgress.ts` — `goalProgressPercent`（Goals 进度：0–1 转为百分比，大于 1 视为已经是百分比）。
- `toolLabels.ts` / `toolLabels.test.ts` — 工具名友好中文标签。
- `notificationRoutes.ts` — 通知类型 → 路由 + 标签。
- `notificationUtils.ts` — `notificationPreview`（截断）。
