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
| `/`（index） | `pages/ChatPage.tsx` | 聊天首页（无会话）→ `ChatHome`。记忆、目标、收件箱、待审批和待确认记忆都读成功且为空时，仍写「我还不太了解你」和「今天没有待决断事项，开始新对话吧」。其中任一还没读到时，不写这两句。读失败时写出原因（有原文用原文；记忆空白则用「加载记忆失败」，目标用「加载目标失败」，收件箱用「加载收件箱失败」，待审批用「加载待审批失败」，待确认记忆用「加载待确认记忆失败」）并给出「重试」。多处一起失败时，先写记忆、目标、收件箱里先失败的那条。「重试」在没有已读到的提示时拿键盘焦点；这次读取结束前按钮留在页面上，原因也不换成空态。已经读到的提示留着，这次失败不抢走它的焦点。「继续上次」和输入框仍在。输入框里还没发出的字会留着，离开首页再回来还在。创建对话成功后才清掉；失败时留着。正在创建时再发送不会再开一份 |
| `/chat/:conversationId` | `pages/ChatPage.tsx` | 活跃会话 → `ChatView`。读取消息失败且当前没有消息时，写出原因（有原文用原文，空白则用「加载消息失败」）并给出「重试」，不显示「开始对话」。读取成功且没有消息时仍是「开始对话」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。从首页带过来、还没发出的那句，要等这次读取成功才发送。工具确认或 ask_user 出现时，焦点落到确认按钮或回答框，不回到已经禁用的输入框。正跟在最新消息时，卡片出现后再把记录滚到底，避免卡片占掉高度后看不到刚才那一轮。已经往上翻了不硬拉，跳转写成「↓ 待确认」，点了才回到底部；没有待确认时仍是「↓ 新消息」。续写失败时卡片留着，ask_user 已经写的回答也留着。输入框里还没提交的字按这条会话留着，换一条或离开再回来还在，不会带到另一条。提交并写进记录后才清掉。还在生成或有待确认时再发送，不会把还没提交的字清掉。从首页带过来的那句也不会清掉这条会话里还没提交的字 |
| `/goals` | `pages/Goals.tsx` | 目标列表 + 详情。与其他主页面共用 `page-shell`；窄屏选中后只显示详情。列表行是链到 `/goals/:id` 的链接（路径按 id 编码），带与时间线相同的焦点环，正在看的那一行标 `aria-current="page"`。窄屏「返回列表」链到 `/goals`。新建、改状态、删除和开始讨论仍是按钮。删除要等这次写成功才关掉。失败时确认框留着。正在删除时，再点删除、取消、Esc 或点外面都不会关掉，也不会再发一次。进度经 `goalProgressPercent`：0–1 乘 100；大于 1 视为已经是百分比，显示不超过 100。列表还在加载时写「加载中…」。读取失败且当前没有目标时，页面上写出原因（有原文用原文，空白则用「加载目标失败」）并给出「重试」，不显示「暂无目标」。读取成功且为空时仍是「暂无目标」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已有目标时，失败只走原有提示，列表仍在。新建目标时，输入法还在组字就按 Enter 不会创建；创建失败时名称留着。正在创建时再按 Enter 不会再开一份 |
| `/goals/:goalId` | `pages/Goals.tsx` | 同上，直接打开该目标详情。目标不存在时的「返回列表」也链到 `/goals`。详情读取失败且不是不存在时，写出原因（空白则用「加载目标详情失败」）并给出「重试」，不一直显示「加载中…」。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。不存在仍是「目标不存在」。此时若列表也读取失败且没有目标，列表栏写出原因，不写「暂无其他目标」，且不抢走详情里的焦点。行动步骤还在组字时按 Enter 不添加。创建失败时这一行留着，成功才清掉。换一个目标时，没发出的步骤和还没添加的 AI 建议都不带到下一个；拆解结果若在换走之后才返回，也不写进当前目标 |
| `/tasks` | `pages/Tasks.tsx` | 任务列表 + 详情。与目标页共用 `page-shell`；窄屏选中后只显示详情，可返回列表。列表分「进行中」「历史」：失败且带 `executable_plan`、且不是简报待办的任务留在「进行中」，行上标「可重新执行」；没有计划的失败、已完成和已取消在「历史」。可创建项目资料简报。新建简报、确认执行、再次运行、定时、验收和返工要等这次写成功才关掉。失败时标题、目标、邮箱选项、资料路径、定时的小时和分钟、验收说明和返工意见都留着。正在提交时，再点确认、取消、Esc 或点外面都不会关掉，也不会再发一次。有评审或已转任务时展示近 30 日首版采纳、返工、已转任务和平均评审耗时，以及按交付执行归因的审批次数、恢复次数和模型成本（已归因金额照常显示，文案是「窗口模型成本」，与单个交付版本上的「模型成本」分开；另有未归因简报调用时标出其金额和次数，例如 `窗口模型成本 $0.0000 · 未归因 $1.5000（1 次）`。读上限打满、`llm_cost` 为 unavailable 时显示「窗口模型成本未分开计」。未归因金额单独不可用时，已有窗口金额后面写「未归因未分开计」）。同一段列出该窗口的 `items`。`items` 为空时不另起列表。读取这份摘要失败且还没有可显示的摘要时，写出原因（有原文用原文，空白则用「加载简报指标失败」）并给出「重试」，不把没读到写成没有评审。读取成功但没有评审、也没有已转任务时，仍不单列这段。「重试」在没有打开任务、且列表自己没有「重试」时拿键盘焦点；打开了任务，或列表正在显示自己的「重试」时，不抢走焦点。这次读取结束前按钮留在页面上。已经显示的摘要在再次读取失败时留着，失败只走提示。非空 `work_id` 打开 `/tasks/:id`（路径按 id 编码）；行上是去掉空白后的 `title`，标题为空时显示「项目简报」。空白 `work_id` 只显示这个标题，不编造链接。列表行是链到 `/tasks/:id` 的链接（路径按 id 编码），带与时间线相同的焦点环，正在看的那一行标 `aria-current="page"`。窄屏「返回列表」链到 `/tasks`。列表还在加载时写「加载中…」。读取失败且当前没有任务时，页面上写出原因（有原文用原文，空白则用「加载任务失败」）并给出「重试」，不显示「暂无任务」。读取成功且为空时仍是「暂无任务」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已有任务时，失败只走原有提示，列表仍在 |
| `/tasks/:taskId` | `pages/Tasks.tsx` | 同上，直接打开该任务详情：交付结果优先，可验收/返工；执行日志可折叠。日志里的 handler 行优先显示调度执行已有的 `error`（超时、死信或重试原因）；该字段为空白时，显示同一次 `ExecuteRequested` 引起的 `ExecuteCompleted.error`（计划内部失败，handler 正常返回：异常文本，或工具步骤 failed/denied 时步骤结果里已有的原因）。空字符串不显示。有 `executable_plan`、且不是简报待办时，状态为 failed，或仍为 running 且当前尝试那条 `ExecuteRequested` 的 handler 已失败或死信，主按钮显示「重新执行」。审批恢复先写请求、handler 再补 `status=running`（`caused_by` 指向该请求）时，这一条仍算当前尝试。这条请求还没有 handler 行时，`handler_execution` 为空；任务仍是 running，不拿上一轮失败把按钮改成「重新执行」。没有计划，或状态为 `waiting_approval`、`cancelled`、`completed` 时，不显示这个「重新执行」按钮。这两种情况下，非空白的 `handler_execution.error` 显示在对应提示旁边；已有交付、执行日志默认折叠时，显示在交付区上方。日志展开后仍显示同一段原文。验收可以填写可选说明，留空不传理由。「已验收」和「已要求返工」的版本在交付区显示该版本非空的 `latest_decision.reason`（空白不显示），版本历史同一行也写出。返工打开带 `reason=rework_restore`。这次 `changes_requested` 之后，或这次打开之后，没有 `ExecuteRequested` 时，当前交付不再显示「已要求返工」，读模型把它呈现为待验收，可以再次验收或返工；决定事件仍在日志里。已经发出 `ExecuteRequested` 的返工仍显示「已要求返工」。收回后若已验收，同一返工幂等键重试不会把页面改回「已要求返工」。有上一版时，交付区显示「相对 vN」：用该版已存储的 findings、sources、limitations、suggested_actions，以及摘要、正文是否变化，对照 `supersedes_delivery_id` 指向的版本现算，不新增事件，也不把上一版全文放进对比结果。第一版或找不到上一版时该字段为 null，不显示这段。结论、限制或待办已有条目差异时，不再另写「正文已更新」；只有正文变了而上述条目没变时才写。交付区列出该版本已存储的 `checks`：`pass` 显示为通过，`fail` 为未通过，`needs_review` 为待判断；非空 `detail` 写在同一行（程序生成的英文说明换成中文，其它原文保留）。没有检查，或条目去掉空白后没有要求、结果和说明时，不显示这段。版本历史同一行写出这三类结果的条数；未通过和待判断带上对应 `criterion`。全部通过时只写通过条数。其它非空结果按原文计数。当前版来自详情里的交付包，历史全文来自单版本读取，字段相同。版本历史里正在看的那一行标出。读取全文时，交付区用转圈占住原来的位置，这一行标为忙碌。失败时在同一处显示原因；「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。再点同一行也会再读一次。已经打开的版本再点不重复请求。只有一版时仍不单列版本历史，交付区下面写「目前只有这一版。」。项目简报还没有任何版本时写「还没有版本历史。」，不另起可点的行。有多版时，方向键在版本行之间移动焦点，Home 与 End 跳到首尾；回车或空格才打开那一版，方向键不另发读取。点开另一版，或从历史版回到当前版时，交付区滚到滚动容器顶部，从这一版的开头看；版本行上的焦点不动。还在加载或这次读取失败时，同样滚到交付区。刚打开任务，或换一个任务时清掉上一份历史版，都不滚。正文为空或只有空白时写「这一版没有正文」。「相对 vN」用与正文相同的下沉底，长编号在面板内换行。交付区写出该版本的 `model_cost`：恢复次数和已归因模型成本（例如 `恢复 2 · 模型成本 $1.2500`）。金额从该执行最早的 `ExecutionRequested` 起计，没有这条事件时从该版发布时间起。这一行的说法是「模型成本」，不是近 N 日合计的「窗口模型成本」。读上限打满时显示「恢复未分开计」或「模型成本未分开计」，不显示 $0。没有执行 id 时恢复为 0、成本为 $0.0000。未归因金额不写在这一行。有多版时，版本历史同一行用同样的措辞写出该版列表里的 `model_cost`（评审状态之后、验收或返工说明之前）；字段缺失时不写这一段。已完成且已有交付的项目简报可以「再次运行」：仍是这一份任务，不记返工；新版本沿用 `changes_from_previous` 对照当前交付。同一状态下可以「定时再次运行」：填写小时或分钟后，用既有 `set_timer` 把这一份的 `work_id` 写入定时 payload。到点再次运行或打开同一份任务；任务已不在时这次触发仍是普通提醒。不另建简报。结论和建议待办上的 `source_ids`，以及「相对 vN」里的来源编号，共用 [`deliverySourceNav`](../../frontend/src/utils/deliverySourceNav.ts)：`id` 完全相同才命中（`email:m1` 不会点到 `email:m10`）。正在看的这一份（含历史版本的单版本读取）的来源行是滚动目标；切到历史版本时不用最新一版的来源行。结论和建议待办，以及「相对 vN」里当前版本的 `source_ids`（新增结论、改写后的结论、新增待办、更新后的待办）可点，滚到该行；`type=email` 且编号为 `email:{message_id}` 时，同时用既有 `getInboxEmailDetail` 打开收件箱详情，不另开 `/inbox/:id`。这一读失败时，交付区写出原因（有原文用原文，空白则用「加载邮件详情失败」）并给出「重试」，交付留着，来源按钮不改成「加载中...」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上，原因也不换成「加载中...」。换一封邮件，或点到不是邮件的来源，就不再沿用上一封的原因。换任务或换正在看的版本同样清掉。右下角提示仍在。文件路径来源行保持纯文本。上一版编号（`previous_source_ids`），以及去掉的结论、去掉的待办、去掉的来源里的来源编号，若仍在正在看的这一份来源行上，走同一套跳转。这些编号若只存在于被比较的上一版、且该来源 `type=email`、编号为 `email:{message_id}`，则打开收件箱详情；页面上没有上一版来源行，所以不滚动。类型来自上一版交付的 `sources`，或 `sources_removed` 上已有的 `type`，不单凭 `email:` 前缀判断。对不上的编号、不在这一份里的文件来源、文件路径，以及「新增来源 / 来源有更新」整行，保持纯文本。正文 `<pre>` 里反引号包住、且与正在看的这一份来源 `id` 完全相同的编号可点，走同一套跳转；反引号里的文件路径和其它文字保持原样。建议待办里非空 `adopted_work_id`（去掉空白后仍非空）的「已转为任务」链到 `/tasks/:id`（路径按 id 编码），焦点环与时间线相同；空白 id 只显示这句，不编造链接。「转为任务」仍是按钮。任务不存在时的「返回列表」链到 `/tasks`。详情读取失败且不是不存在时，写出原因（空白则用「加载任务详情失败」）并给出「重试」，不一直显示「加载中…」。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。不存在仍是「任务不存在」。此时若列表也读取失败且没有任务，列表栏写出原因，不写「暂无其他任务」，且不抢走详情里的焦点 |
| `/inbox` | `pages/Inbox.tsx` | 未读分拣三列（重要 / 需跟进 / 可忽略）+ 最近 15 封（仅标题与发件人，未读加粗；每一行是按钮，带与时间线相同的焦点环。打开后 Esc 回到这一行。同一行还在读详情时再点不会再发一次）+ 最近同步时间/结果/失败原因与「重试同步」。列表还在加载时写「加载中...」。读取失败且当前没有邮件时，页面上写出原因（有原文用原文，空白则用「加载收件箱失败」）并给出「重试」，不显示「还没有同步到邮件」。读取成功且为空时仍是这句。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已有邮件时，失败只走原有提示，列表仍在。同步失败仍是「重试同步」，和这次列表读取分开。点开一封邮件时，详情读取失败写出原因（有原文用原文，空白则用「加载邮件详情失败」）并给出「重试」，列表留着，不把「查看」改成「加载中...」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上，原因也不换成「加载中...」。换一封邮件就不再沿用上一封的原因。已经打开的邮件里，AI 摘要失败同样写出原因（空白则用「摘要生成失败」）并给出「重试」，不改回「AI 正在生成摘要...」。摘要为空时仍写「（无法生成摘要）」。邮件详情打开后焦点进入对话框，Esc 关闭并回到刚才的控件；摘要失败时「重试」仍拿焦点。打开邮件不自动标已读。「查看摘要」同样把焦点放进对话框，Esc 关闭并回到刚才的控件。任务页点来源打开同一封邮件时，用的是同一个详情对话框；读失败写在交付区并给出「重试」，见任务页。某一类没有未读时仍写「暂无」 |
| `/memories` | `pages/Memories.tsx` | 记忆列表 + 图谱（含 `?tab=portrait` 画像、`?tab=review` 待确认 triage：筛选/批量确认拒绝）。列表读取失败且当前没有记忆时，写出原因（有原文用原文，空白则用「加载记忆失败」）并给出「重试」，不显示「我还没有记住任何事」。读取成功且为空时仍是这句。这次读取结束前按钮留在页面上，整页也不改回「加载中…」。待确认这次重试同样不把整页改回「加载中…」。画像读取失败且还没有画像时，写出原因（有原文用原文，空白则用「加载画像失败」）并给出「重试」，不一直显示「正在生成你的 AI 画像…」，也不写成「画像尚未建立」。读取成功且没有洞察时仍是「画像尚未建立」。已经生成的画像在再次读取失败时留着。待确认读取失败且还没有这一页时，写出原因（空白则用「加载待确认记忆失败」），不显示「没有待确认的记忆」或「该分类下没有待确认的记忆」。已拒绝读取失败且还没有列表时，写出原因（空白则用「加载已拒绝记忆失败」），不把这一段藏起来；这次「重试」不抢走待确认区的焦点。图谱读取失败时写出原因（空白则用「加载记忆图谱失败」），不显示「暂无记忆数据可显示」。读取成功且没有节点时仍是这句。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已经载入的列表在失败时留着。点「来源」打开来源链对话框，焦点进入对话框，Esc 关闭并回到刚才的控件。拒绝和编辑也是这样，焦点落在输入框。读取失败时对话框留着，写出原因（有原文用原文，空白则用「加载来源链失败」）并给出「重试」，不改回「加载中...」，列表也留着。右下角提示仍在。「重试」出现时拿键盘焦点；这次读取结束前按钮留在对话框里。读取成功且没有事件时仍是「无事件记录」。换一条记忆不再沿用上一条的原因。上方「记住」在输入法还在组字时按 Enter 不会创建；创建失败时这句话留着。正在创建时再按 Enter 不会再开一份。拒绝时填写的原因、编辑时改过的内容和分类，要等这次写成功才关掉并清掉；失败时对话框和这些字都留着。正在拒绝或保存时，再点、Esc 或点外面都不会关掉，也不会再发一次。「忘掉」同样要等成功才关掉；正在忘掉时 Esc 或取消都不会把它关掉，也不会再发一次。确认和恢复在这次写回来之前不会再发一次，同一行的拒绝也按住。失败时焦点回到刚才的按钮。这一条离开当前列表后，焦点落到下一行还能确认或恢复的按钮；没有下一行时，待确认页回到「待确认」，列表页回到上方输入框。已经把焦点移走时不再抢回来。批量确认和批量拒绝同样在这次写回来之前不会再发一次 |
| `/dashboard` | `pages/Dashboard.tsx` | 「今天」工作台：三栏「需要你决定 / 今天要做 / AI 已处理」+ 近 7 日建议采纳 + 近 7 日与前 7 日对比 + 无法进栏的导流提醒（`?tab=trust` 信任报告、`?tab=monitors` 收件箱/网页监控）。整页还没有任何一块数据时，读取失败写出原因（有原文用原文，空白则用「无法连接到后端服务，请确认后端已启动」）并给出「重试」，不一直停在「加载中...」。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上，原因也不换成「加载中...」。已经有任意一块数据时，失败仍只走提示，页面留着。「执行」面板除最近失败外，还列出 `failed` 里其余失败（最新在前），跳过与最近失败相同的 `id`，以及已在死信列表中的 `id`。最近失败、其余失败、重试中与死信仅在读模型已有 `work_id` 时链到 `/tasks/:id`；没有该字段的行保持纯文本，`correlation_id` 不当作任务 id。同一条执行（相同 `id`）不会在最近失败、其余失败和死信里重复出现。重试中的错误写在行内。返回的定时条目或可再次运行的简报非空时，显示「定时」（各最多 5 条；多出来的定时只写「另有 N 个定时任务」）：定时行只在 payload 里已有 `work_id`（没有该键时用 `action_id`）且任务仍在时链到 `/tasks/:id`，否则纯文本；定时器 id 与 `correlation_id` 不当作任务 id。同一份简报链到该任务，再次运行后的新版本对照当前交付。带 `related_type=work_item` 的提醒在详情里打开 `/tasks/:id`。点开提醒时焦点进入详情对话框，Esc 关闭并回到刚才那一行。未读且已持久化的提醒会标成已读，这一行变淡，侧栏未读数一起刷新。标已读失败时这一行保持未读。临时推送（`source` 为 `live`，或 id 以 `live-` 开头）不标已读。类型 `reminder` 在详情里写成「提醒」。提醒行带与时间线相同的焦点环。信任报告（`?tab=trust`）读取失败且还没有报告时，写出原因（有原文用原文，空白则用「加载信任报告失败」）并给出「重试」，不一直显示「正在生成信任报告…」，也不把各项计数写成 0。读取成功后仍是这份报告。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。已经生成的报告在再次读取失败时留着。信任报告「需要审批」里，非空 `id` 的待审批行打开 `/approvals`；没有 `id` 的行保持纯文本，`correlation_id` 不当作链接。今日三栏里打开审批、收件箱、记忆、目标或仪表盘的行，以及「查看全部目标」「还有 N 个目标」，是链接。执行、定时和这些审批行的链接带上与时间线相同的焦点环；需要截断的文字放在链接里面，焦点环留在链接上。没有 `work_id` 或审批 `id` 的行仍是纯文本。监控页（`?tab=monitors`）读取规则失败且还没有列表时，写出原因（有原文用原文，空白则用「加载监控规则失败」）并给出「重试」，不显示「暂无邮件规则」或「暂无网页监控」。读取成功且为空时仍是这两句。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已经载入的规则在失败时留着。今日三栏还在读取待审批、待确认记忆、收件箱或目标时，不写「今天暂无紧急事项」。其中一栏读取失败且还没有条目时，写出原因（有原文用原文；待审批空白则用「加载待审批失败」，待确认记忆用「加载待确认记忆失败」，收件箱用「加载收件箱失败」，目标用「加载目标失败」，通知用「加载提醒失败」）并给出「重试」，不写「今天暂无紧急事项」「没有待决事项」「没有时限内目标」或「今天还没有处理记录」。读取成功且该栏为空时仍是这些句子。「重试」出现时，页面上第一处拿键盘焦点；这次读取结束前按钮留在页面上。已经载入的条目在失败时留着。「AI 给你的提醒」在通知读取失败且还没有通知时同样写出原因，不写「暂无提醒」。读取成功且为空时仍是「暂无提醒」。从今天点「信任」「监控」或建议采纳进入后，焦点落到「返回今日」。Esc 或点「返回今日」回到今天，并回到刚才那个控件。直接打开 `?tab=trust` 或 `?tab=monitors` 时不抢焦点；这时 Esc 回到「信任」或「监控」。输入框、多行文本或下拉里按 Esc 不离开。信任报告这次读取失败时「重试」仍拿焦点。回到今天时，如果页面上的「重试」已经拿了焦点，就不再抢到刚才的控件 |
| `/settings` | `pages/Settings.tsx` | LLM/邮件/MCP/数据设置。整页配置读取失败时写出原因（有原文用原文，空白则用「无法加载已保存的配置」）并给出「重试」，不一直显示「加载设置…」。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。MCP 服务器列表读取失败且还没有状态时，写出原因（有原文用原文，空白则用「加载 MCP 服务器失败」）并给出「重试」，不写成「MCP 未启用或连接信息不可用」或「暂无 MCP 服务器」。未启用仍是前一句。已启用且服务器为空时仍是「暂无 MCP 服务器」。MCP 市场读取失败且还没有列表时，写出原因（空白则用「加载 MCP 市场失败」），不显示「暂无可用 MCP 服务器」。读取成功且为空时仍是这句。系统人设读取失败且还没有配置时，写出原因（空白则用「加载人设配置失败」），不展示空白表单。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。能力策略读取失败且还没有分级时，写出原因（有原文用原文，空白则用「加载能力策略失败」）并给出「重试」，不一直显示「加载策略中…」，也不写成「（无）」。读取成功后仍是自动执行、需要确认和禁止。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上。已经载入的配置或列表在失败时留在页面上。Telegram 网关读取失败且还没有状态时，写出原因（有原文用原文，空白则用「加载 Telegram 状态失败」）并给出「重试」，不一直显示「加载 Telegram 状态…」。读取成功后仍是轮询开关和连接状态。这次「重试」出现时拿键盘焦点，读取结束前按钮留在页面上。「保存 LLM 配置」和「保存邮箱配置」成功后在按钮旁写「已保存」；再改表单就清掉这句。保存还没回来时如果表单又改了，回来后也不写「已保存」。保存失败仍只走右下角提示，不写「已保存」。正在保存时再点不会再发一次。LLM 某一家「测试」成功后在这一家下面写「连接正常」；失败仍走提示，不写「连接正常」。再改这一家的字段，或测试还没回来时改了字段，都不写「连接正常」。正在测试时再点不会再开一次。邮箱「测试连接」仍用 IMAP / SMTP 结果。销毁全部数据先打开确认框，要等这次写成功才关掉。失败时确认框留着。正在销毁时，再点销毁、取消、Esc 或点外面都不会关掉，也不会再发一次 |
| `/approvals` | `pages/Approvals.tsx` | 审批队列。`ask_user` 必须先填写文本再「发送回答」，经 chat resolve 续写同一工具环；取消不带回答。非空 `task_id`（去掉空白后仍非空）打开 `/tasks/:id`（路径按 id 编码）；空白、null 或只有空白的 `task_id` 保持纯文本，`correlation_id` 不当作任务 id。列表还在加载时写「加载中…」。读取失败且当前没有待审批项时，页面上写出原因（接口错误原文，空白则用「加载审批列表失败」）并给出「重试」，不显示「暂无待审批项」或「所有高风险操作已处理完毕」。读取成功且为空时仍是这两句。「重试」出现时拿键盘焦点；这次读取结束前按钮留在页面上。已有待审批项时，失败只走原有提示，列表仍在。批准、拒绝或发送回答在这次请求回来前不会再发一次，这张卡片上的按钮和回答框都按住。失败时 ask_user 已经写的回答留着，焦点回到刚才的按钮。拒绝或批准后还留在这一页时，焦点落到下一张还能用的主按钮（还没写回答就落到回答框）；没有下一张时回到「刷新」。已经把焦点移到别的控件上时，不再抢回来。续写成功并打开对话时，不再把焦点留在审批页 |
| `/timeline` | `pages/Timeline.tsx` | 人生事件时间线。非空 `work_id`（去掉空白后仍非空）的事件描述打开 `/tasks/:id`（路径按 id 编码）；空白、null 或只有空白保持纯文本。不读 `payload_snippet`，也不把 `correlation_id` 当成任务 id。标题在加载、为空和失败时都留着。加载时写「加载中…」。还没有事件时写「还没有任何事件」，并说明开始对话或创建目标后会出现记录。首次读取失败时写出原因（有原文用原文，空白则用「加载时间线失败」）并给出「重试」，不写成还没有事件。已经列出的事件若继续加载失败，仍留在页面上，同一处重试下一页。「重试」出现时拿键盘焦点，这次读取结束前按钮留在页面上 |

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
| `useApprovalFlow` | [`useApprovalFlow.ts`](../../frontend/src/hooks/useApprovalFlow.ts) | 管理待工具确认；inflight 审批去重；批准后续写若返回下一审批则立即展示。续写失败时不卸下当前卡片 |
| `useNotifications` | [`useNotifications.ts`](../../frontend/src/hooks/useNotifications.ts) | 持有单 socket WebSocket；指数退避重连（封顶 60s，无次数上限）；`online` 与页面重新可见时立即重连；toast + 实时通知；每 payload 转发到失效桥 |
| `useWsInvalidationBridge` | [`useWsInvalidationBridge.ts`](../../frontend/src/hooks/useWsInvalidationBridge.ts) | 见上 |
| `useDashboard` | [`useDashboard.ts`](../../frontend/src/hooks/useDashboard.ts) | 见上 |
| `useMemoriesGroupedQuery` | [`useMemoriesQuery.ts`](../../frontend/src/hooks/useMemoriesQuery.ts) | 见上 |

## 组件

[`frontend/src/components/`](../../frontend/src/components/)：

- **`ui/`** — 原语：`Button`、`Badge`、`Card`、`Dialog`、`EmptyState`、`ErrorBoundary`、`Input`（含 `PasswordInput`）、`Spinner`。每个有 co-located `.test.tsx`。
- **`layout/`** — `Sidebar.tsx`（聊天列表 + 导航，[`Sidebar.tsx`](../../frontend/src/components/layout/Sidebar.tsx)。展开的会话列表还在加载时写「加载中…」。读取失败且还没有会话时写出原因（有原文用原文，空白则用「加载对话失败」）并给出「重试」，不显示「暂无对话」。读取成功且为空时仍是「暂无对话」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在列表里。已经列出的会话在失败时留着。删除对话要等这次写成功才关掉。失败时确认框留着。正在删除时，再点删除、取消、Esc 或点外面都不会关掉，也不会再发一次）、`NotificationBell.tsx`（下拉还在加载时写「加载中…」。读取失败且还没有通知时写出原因（有原文用原文，空白则用「加载通知失败」）并给出「重试」，不显示「暂无通知」。读取成功且为空时仍是「暂无通知」。「重试」出现时拿键盘焦点；这次读取结束前按钮留在下拉里。已经列出的通知在失败时留着。下拉打开后焦点进入面板，Esc 关闭并回到铃按钮；点外面关掉时焦点留在点到的地方。从一条通知打开详情后，Esc 仍回到铃）。
- **`chat/`** — `ChatView.tsx`（活跃会话；读取消息失败且还没有消息时写出原因并给出「重试」，不显示「开始对话」；还没提交的字按会话留着；`ProposedMemoryBanner` 只展示当前会话 `source=conv:{id}` 的待确认记忆，toast 文案为「待确认」）、`ChatHome.tsx`（落地；近况没读全时写出原因并给出「重试」，不显示「我还不太了解你」；横幅仍用全局 proposed 计数；「继续上次」链到该会话，带地址的提示如「去审批」是链接，开始对话这类仍是按钮；输入框里还没发出的字会留着，创建对话成功后才清掉）、`MessageItem.tsx`（正文链接带与时间线相同的焦点环；与当前站点同源的地址走路由，外链仍新开标签）、`ToolCallDisplay.tsx`、`ContextPanel.tsx`（活跃目标链到 `/goals/:id`。这一段还在加载时写「加载中…」。读取失败且还没有目标时写出原因（有原文用原文，空白则用「加载目标失败」）并给出「重试」，不显示「暂无活跃目标」。读取成功且为空时仍是「暂无活跃目标」。「重试」出现时拿键盘焦点；这次读取结束前按钮留着。已经列出的目标在失败时留着）、`ConfirmationDialog.tsx`（审批模态；`needs_user` 写工具用「建议」话术；`ask_user` 展示问题与文本回答。出现时焦点落到确认按钮或回答框。正跟在最新消息时，记录再滚到底；已经往上翻了则显示「↓ 待确认」。续写未完成时按钮按住，回答留着）、`VoiceInput.tsx`、`CodeBlock.tsx`（懒加载 `react-syntax-highlighter`）。
- **`dashboard/`** — `todayBuckets.ts` 纯前端分桶：需要你决定（待审批 / 待确认记忆 / important·actionable 邮件）、今天要做（3 日内截止或停滞目标）、AI 已处理（当日晨报 / 收件箱摘要 / 目标进展 / 可忽略邮件计数）。`AdoptionSummary` 在今日页展示近 7 日采纳率（工具建议确认 + 记忆确认，数据来自 `GET /api/telemetry/governance`），点击进入信任页。`PeriodComparison` 展示近 7 日与前 7 日的完成目标、完成任务、新邮件和采纳率（`GET /api/dashboard/periods`）；`work_completed_untyped` 只在非零时出现。收回用的 `rerun_restore` / `rework_restore` 不进完成数。`RemindersPanel` 只保留 `reminder` / `url_monitor` / `morning_brief_failed`，先按 `related_id` 去重再截断。`morning_brief` 通知路由到 `/dashboard`。今日三栏在待审批、待确认记忆、收件箱、目标或通知还在读取、或读取失败且该栏还没有条目时，不把这一栏写成空；成功的空栏和「暂无提醒」保持原句。
- **`notifications/`** — `NotificationDetailModal.tsx`（打开时焦点进入对话框，Esc 关闭并回到原控件；`reminder` 写成「提醒」）。
- **`onboarding/`** — `OnboardingWizard.tsx`（首次运行，`localStorage.onboarding_done` 门控）。

侧栏导航模型（[`Sidebar.tsx`](../../frontend/src/components/layout/Sidebar.tsx)）：

- 分组「概览」：`/`「对话」、`/dashboard`「概览」
- 分组「任务」：`/goals`「目标」、`/tasks`「任务」、`/inbox`「收件箱」、`/approvals`「审批」（角标：收件箱未读、待审批）
- 分组「知识」：`/memories`「记忆」、`/timeline`「时间线」。待确认记忆角标大于 0 时，「记忆」链到 `/memories?tab=review`
- 分组「系统」：`/settings`「设置」；底部通知铃。铃的下拉打开后焦点进入面板，Esc 回到铃。读取失败且还没有通知时写出原因并给出「重试」，不写成「暂无通知」
- 侧栏可收起（`localStorage.sidebar_collapsed`）；会话列表只在 chat 路由且展开时显示。会话标题是链到 `/chat/:id` 的链接，带与时间线相同的焦点环，当前会话标 `aria-current="page"`；删除仍是旁边的按钮。列表还在加载时写「加载中…」。读取失败且还没有会话时写出原因并给出「重试」，不写成「暂无对话」；读取成功且为空时仍是这句。视口窄于 `md`（768px）时强制保持图标栏宽度，不改已保存的收起偏好，避免主内容被 240px 侧栏挤没

## Layout

[`frontend/src/Layout.tsx`](../../frontend/src/Layout.tsx) 渲染：

1. `<Sidebar>`（展开 240px / 收起或窄屏 68px）含会话列表 + 导航。
2. Banner 覆盖层：(a) 后端需认证但未配 token，(b) 后端不可用。
3. Toast 栈（右下，`bottom-20 right-4`）：WS 实时通知 + `useErrorStore` 错误 toast。
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
