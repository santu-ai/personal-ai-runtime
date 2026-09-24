# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 2026-09-24：Batch 89：收件箱未读卡片上的「标记已读」和「让 AI 处理」在这次请求回来之前不会再发一次，同一张上的另一个也不会发出。按钮不禁用，点到的那个标为忙碌，焦点留在上面。失败时仍留在刚才的按钮。标记已读成功后，焦点还在原处或落在页面空白处时落到同一列下一张的「标记已读」；没有下一张就落到这封在最近邮件里的那一行；再没有就回到「立即轮询」。已经把焦点移走时不再抢。「让 AI 处理」仍然只开一次对话。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 88：目标详情里暂停、完成、恢复、勾选行动步骤和 AI 拆解在这次请求回来之前不会再发一次。控件不禁用，标为忙碌，焦点留着。暂停成功且焦点还在原处时落到「恢复」；恢复成功落到「暂停」；完成成功落到「就此目标对话」。已经把焦点移走时不再抢。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 87：时间线「加载更多」在这次读取结束前不会再发一次，按钮留着并标为忙碌。还有下一页时，焦点还在这个按钮上就留在这里。已经没有更早的记录时，落到新出现的任务链接；没有这样的链接就落到「已经是最早的记录」。首次失败后重试成功，落到第一条任务链接；没有链接但还有下一页就落到「加载更多」；只有不能打开的事件就落到事件列表；仍然没有事件就落到空态。已经把焦点移到别的控件时不再抢。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 86：记忆页确认或恢复在这次写回来之前不会再发一次，同一行的拒绝也按住。失败时焦点回到刚才的按钮。这一条离开当前列表后，焦点落到下一行还能确认或恢复的按钮；没有下一行时，待确认页回到「待确认」，列表页回到上方输入框。已经把焦点移走时不再抢回来。批量确认和批量拒绝同样不会连发。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 85：从今天打开信任、监控或建议采纳后，焦点落到「返回今日」。Esc 或点「返回今日」回到刚才那个控件。直接打开带 tab 的地址时不抢焦点。输入框里按 Esc 不离开。已经有别的控件（例如「重试」）拿着焦点就不再抢。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 84：审批页批准、拒绝或发送回答在这次请求回来前不会再发一次。失败时 ask_user 已经写的回答留着，焦点回到刚才的按钮。还留在这一页时，焦点落到下一张；没有下一张就回到「刷新」。已经把焦点移走时不再抢回来。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 83：收件箱最近邮件每一行是按钮，带与时间线相同的焦点环。打开后 Esc 回到这一行。同一行还在读详情时再点不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 82：设置里销毁全部数据先打开确认框，要等这次写成功才关掉。失败时确认框留着。正在销毁时，再点销毁、取消、Esc 或点外面都不会关掉，也不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 81：侧栏删除对话和目标页删除目标要等这次写成功才关掉。失败时确认框留着。正在删除时再点删除、取消、Esc 或点外面都不会关掉，也不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 80：任务页新建简报、确认执行、再次运行、定时、验收和返工要等这次写成功才关掉。失败时标题、目标、邮箱选项、资料路径、定时的小时和分钟、验收说明和返工意见留着。正在提交时再点确认、取消、Esc 或点外面都不会关掉，也不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 79：记忆页拒绝、编辑和忘掉要等这次写成功才关掉。拒绝原因、改过的内容和分类在失败时留在对话框里。正在提交时再点、Esc 或点外面都不会关掉，也不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 78：对话输入框里还没提交的字会留着。换一条会话，或离开再回来，各自还在，不会带到另一条。提交并写进记录后才清掉。还在生成或有待确认时再发送，不会把还没提交的字清掉。首页同样留着；创建对话成功后清掉，失败时留着，正在创建时不会再开一份。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 77：任务页点开另一版，或从历史版回到当前版时，交付区滚到滚动容器顶部，版本行上的焦点留着。全文还在读或读失败时也滚到这一块。刚打开任务，或换任务清掉上一份历史版，都不滚。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 76：对话里工具确认或 ask_user 出现时，正跟在最新消息就把记录再滚到底，避免卡片占掉高度后看不到刚才那一轮。已经往上翻了不硬拉，跳转写成「↓ 待确认」，点了才回到底部。没有待确认时仍是「↓ 新消息」。焦点仍落在确认或回答。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 75：设置里保存 LLM 或邮箱成功后，按钮旁写「已保存」。再改表单，或保存还没回来时又改了，这句就清掉。保存失败仍只走提示。LLM 某一家测试成功后写「连接正常」；失败不写这句。正在保存或测试时再点不会再发一次。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 74：记忆页上方「记住」和快速捕获在输入法组字时按 Enter 不提交。创建失败时这句话留着。正在提交时不会再开一份。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 73：目标新建和行动步骤在输入法组字时按 Enter 不提交。创建失败时草稿留着，正在提交时不会再开一份。换一个目标时，没发出的步骤和还没回来的拆解建议不带到下一个。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 72：通知铃下拉打开后焦点进入面板，Esc 关闭并回到铃按钮。点外面关掉时焦点留在点到的地方。从下拉里打开详情后，Esc 仍回到铃。读取失败时「重试」仍拿焦点。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 71：邮件详情、收件箱摘要、记忆来源链、拒绝、编辑和快速捕获打开后，焦点进入对话框，Esc 关闭并回到刚才的控件。摘要或来源链失败时「重试」仍拿焦点。打开邮件不自动标已读。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 70：今日提醒点开后焦点进入详情，Esc 回到刚才那一行。未读且已持久化的提醒标成已读后这一行变淡，侧栏未读数一起刷新；标已读失败时这一行保持未读。临时推送不标已读。类型 `reminder` 在详情里写成「提醒」。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 69：对话里工具确认或 ask_user 出现时，焦点落到确认按钮或回答框，不回到已经禁用的输入框。续写失败时卡片留着，ask_user 已经写的回答也留着。批准、拒绝和下一张卡片仍走原来的续写。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 68：记忆页点「来源」打开来源链时，读失败写在对话框里并给出「重试」，对话框留着，不改回「加载中...」。重试期间原因留着。换一条记忆不沿用上一条的原因。读成功且没有事件时仍是「无事件记录」。右下角提示仍在。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 67：任务页点来源打开邮件时，读失败写在交付区并给出「重试」，交付留着，来源按钮不改成「加载中...」。重试期间原因留着。换一封邮件、点到不是邮件的来源、换任务或换正在看的版本，都不沿用上一封的原因。仍用既有 `getInboxEmailDetail`，不另开 `/inbox/:id`。右下角提示仍在。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 66：收件箱点开一封邮件时，详情读失败写出原因并给出「重试」，列表留着，「查看」不再改成「加载中...」。已经打开的邮件里，摘要失败同样留住原因再重试，不改回「AI 正在生成摘要...」。换一封邮件不沿用上一封的原因。任务页点来源打开邮件仍只走提示。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 65：今日整页在还没有任何一块数据时，读取失败写出原因并给出「重试」，重试期间不改回「加载中...」。空白原因用「无法连接到后端服务，请确认后端已启动」。已经有任意一块数据时，失败仍只走提示。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 64：画像、信任报告、设置里已保存的配置和能力策略，读取失败且还没有数据时写出原因并给出「重试」，重试期间不改回「正在生成…」「加载设置…」或「加载策略中…」。记忆列表和待确认的重试也不再把整页改回「加载中…」。成功的空态保持原句。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 63：任务页近 N 日简报读取失败且还没有摘要时写出原因并给出「重试」，不再把没读到写成没有评审。已经显示的摘要在再次读取失败时留着。读取成功但没有评审、也没有已转任务时，仍不单列这段。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 62：设置里的 Telegram 网关读取失败且还没有状态时写出原因并给出「重试」，不再停在「加载 Telegram 状态…」。读取成功后仍是轮询开关。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 61：侧栏会话列表、通知铃下拉和上下文里的活跃目标，读取失败且还没有条目时写出原因并给出「重试」，不显示「暂无对话」「暂无通知」或「暂无活跃目标」。读取成功的空列表保持原句。已经列出的条目在失败时留着。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 60：聊天首页在记忆、目标、收件箱、待审批或待确认记忆还没读到时，不写「我还不太了解你」或「今天没有待决断事项」。读失败写出原因并给出「重试」；已经读到的提示留着。读全且为空时仍是原来的空态。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 59：对话页读取消息失败且当前没有消息时，写出原因并给出「重试」，不显示「开始对话」。空白原因用「加载消息失败」。从首页带过来还没发出的那句，要等这次读取成功才发送。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 58：今日三栏在待审批、待确认记忆、收件箱、目标或通知读取失败且该栏还没有条目时写出原因和重试，不写「今天暂无紧急事项」。提醒在通知读取失败且还没有通知时同样分开。读取成功的空栏保持原句。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 57：收件箱、记忆列表/待确认/已拒绝/图谱、设置里的 MCP 服务器、MCP 市场和系统人设，以及监控规则，读取失败且还没有数据时写出原因并给出「重试」，不再显示成空列表或空白表单。已有数据时失败仍只走提示。信任报告整页原本已分开。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 56：目标和任务列表读取失败且当前没有条目时，写出原因并给出「重试」，不再显示「暂无目标」或「暂无任务」。详情读取失败且不是不存在时同样重试，不再一直停在「加载中…」。已有列表时失败仍只走提示。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 55：审批列表读失败时写出原因和「重试」，不再显示「暂无待审批项」或「所有高风险操作已处理完毕」。时间线的标题在加载、为空和失败时都留着；首次失败和继续加载失败用同样的「重试」，已经列出的事件还在。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 54：目标列表和任务列表里打开详情的行改成链接，可以新开标签，焦点环与时间线相同，正在看的那一行标 `aria-current="page"`。窄屏和找不到时的「返回列表」也是链接。建议待办里非空 `adopted_work_id` 的「已转为任务」链到对应任务，空白 id 只显示文字。新建、验收、转为任务仍是按钮。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 53：任务页只有一版时写「目前只有这一版」，不单列版本历史。项目简报还没有版本时写「还没有版本历史」。有多版时方向键在版本行之间移动焦点，Home 与 End 跳到首尾，回车才打开。正文为空或只有空白时写「这一版没有正文」。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 52：聊天首页「继续上次」和「去审批」、侧栏会话标题、上下文里的活跃目标，以及正文里与当前站点同源的链接，都是可以新开标签的链接，并带上与时间线相同的焦点环。开始对话这类提示仍是按钮。侧栏当前会话标 `aria-current="page"`，删除仍是旁边的按钮。首页 E2E 只在侧栏第一个 nav 里按完整名称「对话」找主导航，避免和会话标题、继续上次撞名。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 51：今日三栏和空状态里的目标入口改成链接。执行、定时和信任报告「需要审批」的已有链接补上与时间线相同的焦点环；截断文字放在链接里面。没有 `work_id` 或审批 `id` 的行仍是纯文本。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 50：任务页读取历史全文时，转圈留在交付区，正在看的那一行标为忙碌。失败后的「重试」拿键盘焦点，请求结束前不卸下；读完后若焦点已丢，落到该版标题。换一版会清掉上一条失败。「相对 vN」用与正文相同的下沉底，长编号在面板内换行。只有一版时仍不单列版本历史。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 49：任务页版本历史标出正在看的一行。全文加载失败时可以重试；再点同一行也会再读一次。成功打开后再点同一行不重复请求。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 48：文档对齐 `f08835e`。收回后的返工若被后续验收替换，旧幂等键只回放（`replayed` 且 `superseded`）不再派发；死信 `limit` 只计实际重放的行，扫描越过终态或旧尝试；单次交付 `model_cost` 从该执行最早的 `ExecutionRequested` 起，没有这条事件时从发布时间起。写在 `docs/01-overview/architecture.md`、`docs/02-concepts/execution-model.md`、`docs/03-subsystems/frontend.md`、`docs/03-subsystems/backend-api.md`、`docs/03-subsystems/backend-core.md` 与 `docs/04-data/data-model.md`。#131–#134 的版本历史成本、信任报告审批链接、审批卡片 `task_id` 和时间线 `work_id` 已在各自 PR 写入文档，本批不改跳转。不新增事件类型，未改 Kernel。
- 2026-09-24：Batch 47：时间线事件在已有非空 `work_id`（去掉空白后仍非空）时，描述打开 `/tasks/:id`（路径按 id 编码）。空白、null 或只有空白保持纯文本。接口只从事件里已有的 `work_id` / `task_id` 取值：顶层 `work_id` 优先，没有该键才用顶层 `task_id`；键在但空白或不是字符串时不改用别的键。审批的 `task_id` 在 `ctx`。`WorkItem*` 用 `aggregate_id`。`TimerFired` 只读嵌套定时 payload 里的这两个键。不读 `payload_snippet`，不用 `correlation_id`、`parent_work_id`、`action_id`、定时器 id 或审批 id。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 46：审批卡片在非空 `task_id`（去掉空白后仍非空）时打开 `/tasks/:id`（路径按 id 编码）。空白、null 或只有空白的 `task_id` 保持纯文本，不把 `correlation_id` 当成任务 id。对话来源的 `conversation_id` 续写行为不变。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：修复近 24 小时审查发现的三处回归：后续验收会使旧返工幂等重试变成无副作用回放；死信 `limit` 按实际可重放行计数；单次交付成本从该 execution 的 `ExecutionRequested` 起覆盖完整生命周期。新增三项回归测试；完整后端 1750 passed、9 skipped、6 deselected，lint/boundary/layer-deps/architecture-check/docs-links 通过。
- 2026-09-24：审查 09-23 11:41 至 09-24 11:41 的提交（75186af..6ead56c）：后端重点 120 测试、前端 311 测试及 boundary/layer-deps/architecture-check 通过。临时用例复现：撤回返工后验收，重试旧幂等键仍派发；死信先截 limit 再过滤导致后续可重放项饥饿；单次交付成本漏掉发布前超过一天的同 execution_id 调用。临时用例已移除，未改业务代码。
- 2026-09-24：Batch 45：信任报告「需要审批」里，非空 `id` 的待审批行打开 `/approvals`。没有 `id` 的行仍是纯文本。不把 `correlation_id` 当成链接。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 44：任务详情有多版时，版本历史同一行写出该版列表里的 `model_cost`（恢复次数和「模型成本」，措辞与交付区相同；`unavailable` 为「未分开计」，不写成 $0）。字段缺失时不补这段。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 43：文档对齐 #125–#129。审批恢复先写 `ExecuteRequested`、handler 再补 running（`caused_by` 指向该请求）时仍是当前尝试，启动恢复、死信收口、`latest_execute_handler_failed` 和死信重放共用这一判定，写在 `docs/01-overview/architecture.md`、`docs/02-concepts/execution-model.md` 与 `docs/03-subsystems/backend-core.md`。任务页来源跳转（`deliverySourceNav`：相对 vN 的当前与上一版编号、去掉的条目、正文反引号精确匹配；只在上一版的邮件打开收件箱且不滚动）和近 N 日「窗口模型成本」及非空 `work_id` 打开 `/tasks/:id`，写在 `docs/03-subsystems/frontend.md`。`delivery-metrics` 的 `items` 写在 `docs/03-subsystems/backend-api.md`。不新增事件类型，未改 Kernel。
- 2026-09-24：Batch 42：任务页近 N 日简报的金额写成「窗口模型成本」，和单个交付版本上的「模型成本」分开。同一段列出该窗口的简报；非空 `work_id` 打开 `/tasks/:id`，空白 id 保持纯文本。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-24：Batch 41：「相对 vN」里上一版编号和去掉的条目，若来源 id 仍在当前这份交付的来源行上，与结论、建议待办共用 `deliverySourceNav`。只存在于被比较的上一版、且 `type=email` 的 `email:{message_id}` 打开既有收件箱详情，不滚动（上一版来源行不在页面上）。对不上的编号、不在当前交付里的文件来源、文件路径，以及「新增来源 / 来源有更新」整行，保持纯文本。正文 `<pre>` 里反引号包住且与当前来源 id 完全相同的编号走同一套跳转。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-23：Batch 40：「相对 vN」里当前版本的 `source_ids` 与结论、建议待办共用 `deliverySourceNav`：滚到同一交付的来源行；`type=email` 且 `email:{message_id}` 时打开既有收件箱详情。上一版编号、去掉的条目、文件路径来源，以及正文 `<pre>` 里的反引号编号，仍是纯文本。不新增事件类型，未改 Kernel，未改 `read_ports/work.py`。
- 2026-09-23：Batch 39：任务详情里结论和建议待办的 `source_ids` 可点，滚到同一交付里 id 相同的来源行。`type=email` 且编号为 `email:{message_id}` 时，用既有 `getInboxEmailDetail` 打开收件箱详情，不新开 `/inbox/:id`。文件路径来源保持纯文本。不新增事件类型，未改后端。
- 2026-09-23：Batch 38：审批恢复先写 `ExecuteRequested`、handler 再补 `WorkItemStatusChanged(running)`（`caused_by` 指向该请求）时，这条请求仍是当前尝试。`_current_execute_requested` 与任务详情 `_snapshot_execute_requested` 是同一函数。启动恢复、死信收口、`latest_execute_handler_failed` 和死信重放不再把它当成没有当前尝试。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 37：文档对齐 `e863c8f` 与 #117–#123。当前尝试、半开 `rerun_restore` / `rework_restore`、`rerun_stash`、死信跳过终态与 `not_current_attempt`、按 `execution_id` 的 `model_cost`，写在 `docs/02-concepts/execution-model.md`；周期统计排除这两种收回。不新增事件类型，未改 Kernel。
- 2026-09-23：Batch 36：任务详情里每个交付版本带 `model_cost`，只计该版本 `execution_id` 的已归因金额和恢复次数。其它执行和缺少 `caused_by` 的金额不并进来。这一读打满上限时两项都是 unavailable，不写成 0。没有 `execution_id` 时为 0。近 N 日汇总仍是窗口合计。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 35：`replay_dead_letters` 在领域 Work 已是 `failed` / `completed` / `cancelled` 时不把死信再排成 pending（`work_terminal:<status>`，不发 Execution*）。不是最新 `status=running` 之后那条 `ExecuteRequested` 的死信同样跳过（`not_current_attempt`）。Work 仍为 running 且死信属于当前这次请求时，重放仍排成 pending。没有对应 Work 的执行仍重放。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 34：返工收回（`reason=rework_restore`）之后，若这次 `changes_requested` 之后或这次打开之后没有 `ExecuteRequested`，任务页不再把当前交付显示成「已要求返工」。读模型把它呈现为待验收，可以再次验收或返工；决定事件仍在。已经派出的返工仍是「已要求返工」。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 33：返工把 `completed` 或 `failed` 收成 pending 时带 `reason=rework_restore`，计划游标仍进 `rerun_stash:{work_id}`。`ExecuteRequested` 没落库时，同一次失败、再次提交或启动恢复放回游标，并把 Work 收回打开前的状态。不用 `rerun_restore`，收回不算新的完成，也不启动后继。已经发出 `ExecuteRequested` 的返工打开不收回。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 32：任务详情 `handler_execution` 只认最新 `status=running` 之后的 `ExecuteRequested`。这条请求还没有 handler 行时快照为空，不显示上一轮失败，按钮也不因此变成「重新执行」。handler 在请求之后补写的 `running`（`caused_by` 指向该请求）仍算这一次。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 31：再次运行清计划游标时，同一事务把行写入 `plan_resumes` 的 `rerun_stash:{work_id}`。`ExecuteRequested` 落库后删掉暂存。进程死在打开与派发之间时，启动恢复放回游标并收回 `completed`；原行还在则只删暂存。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 30：死信收口和「最新 handler 已失败」都改成只认最新 `status=running` 之后的 `ExecuteRequested`。再次运行打开成 pending 时带上已有的 `reason=rerun_restore`；进程若死在执行请求落库前，启动恢复用同一条 `WorkItemStatusChanged(completed)` 收回。已经清掉的计划游标补不回来。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：修复近 24 小时审查发现的三处回归：启动恢复只关联最近一次进入 running 后的 ExecuteRequested，周期统计排除 rerun_restore，重跑清理进度失败会收回 completed。新增三项故障回归测试；后端 1708 passed、lint、boundary、layer-deps、architecture-check 通过。
- 2026-09-23：审查近 24 小时提交（0406412..259f762）：前端 298 测试及构建、后端重点 77 测试、boundary/layer-deps/architecture-check 通过；临时故障用例复现三处缺口：重跑派发中断恢复误用上一轮完成、rerun_restore 被周期统计计作完成、清理计划进度失败后停在 pending。临时用例已移除，未修改业务代码。
- 2026-09-23：Batch 29：再次运行失败收回的 `WorkItemStatusChanged(completed)` 带 `reason=rerun_restore`。依赖钩子只启动 `dependencies_json` 列出这一项且依赖都已完成的待执行后继；收回和没有依赖的待办都不会被标成 `running`。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 28：再次运行已完成简报时，执行请求若在重新打开之后失败，用既有 `WorkItemStatusChanged(completed)` 收回状态，并放回刚才清掉的计划进度。当前交付不变。计划在打开前就不能执行时不改状态。定时到点走同一条路径。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 27：文档对齐 #88–#113 之后仍漂移的陈述。测试文件数为 203；删掉不存在的 `trigger_evaluation` cron，补上 `telegram_poll` 与 `reminder` 的 `work_id` 行为；启动恢复写明 task/action 与终态失败条件；toast 在右下。全局周期对比与简报版本差仍分开写。未改守卫脚本。
- 2026-09-23：Batch 26：已完成且已有交付的项目简报可以「定时再次运行」。既有 `set_timer` 的 payload 写入这一份的 `work_id`。到点若仍可再次运行，就跑同一份任务；否则提醒只打开它。不新建任务，不为这次触发另建交付。`GET /api/dashboard/periods` 仍是全局对比。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 25 CI：真实后端 e2e 同时占住两个临时端口再分别交给假 LLM 和 uvicorn，避免健康检查打到假 LLM 的 GET 501。后端 stdout 会读完，避免管道写满卡住启动。
- 2026-09-23：Batch 25：定时 payload 没有任务 id 时不编造链接。已有非空 `work_id`（没有该键时用 `action_id`）且任务仍在，仪表盘定时行才打开 `/tasks/:id`。已完成且已有交付的项目简报可再次运行：同一任务、不记返工，下一版仍用 `changes_from_previous`。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 24：任务页验收时可以填写可选说明，留空不传 `reason`。已验收版本在交付区显示非空的 `latest_decision.reason`，版本历史同一行也写出；空白不显示。沿用既有 `accept` 与 `latest_decision`，不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 23：任务页交付区列出该版本已存储的 `checks`（通过 / 未通过 / 待判断），非空说明写在同一行。版本历史同一行写出条数；未通过和待判断带上要求。空白检查不显示。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 22：任务页对已有上一版的交付显示「相对 vN」。`changes_from_previous` 在读取时对照 `supersedes_delivery_id`，比较已存储的 findings、sources、limitations、suggested_actions，以及摘要和正文是否变化。不复制上一版全文，不新增事件类型。第一版或上一版缺失时为 null。未改 `read_ports/work.py`。
- 2026-09-23：Batch 21：任务页交付包和 `WorkDelivery` 带上该版本已有的 `latest_decision`（含 `reason`）。「已要求返工」时交付区显示返工理由，版本历史同一行也写出。空白理由不显示。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 20：交付指标对缺少 `caused_by` 的成功 `project_brief` 调用另计 `unattributed_project_brief_cost`，不并入 `llm_cost`；读上限打满时该金额与次数仍是 unavailable。任务页在未归因次数旁写出这笔金额。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 19：交付指标里缺少 `caused_by` 的成功 `project_brief` 调用另计 `unattributed_project_brief_calls`，已归因金额照常加总；读上限打满时金额和次数仍是 unavailable。任务页在金额后标出未归因次数。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 18：任务已失败，或仍为 running 且 handler 已失败/死信时，非空白的 `handler_execution.error` 显示在「重新执行」提示旁；已有交付、日志默认折叠时，显示在交付区上方。日志里的原文仍保留。不改 Kernel，不改 `read_ports`。
- 2026-09-23：Batch 17：计划工具步骤返回 failed/denied 时，把步骤结果里已有的失败原因写入 `ExecuteCompleted.error`。任务详情仍走 Batch 16 的同一条路径。空白原因不写；`continue_on_error` 后计划完成的不写。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 16：任务详情在调度行 `error` 为空白时，显示同一次 `ExecuteRequested` 引起的 `ExecuteCompleted.error`。`on_execute_requested` 抓住异常后写入异常文本（空白则用异常类型名）再正常返回，不再写成 `handler_failed`。超时/死信仍优先用调度行上的错误。不新增事件类型。`read_ports/work.py` 仍为 598/600。
- 2026-09-23：Batch 15：任务详情 `include=execution` 的 `handler_execution` 带上调度行已有的 `error`（空白为 null），执行日志直接显示。不新增事件类型。
- 2026-09-23：Batch 14：仪表盘「执行」把 `failed` 里除最近一条以外的失败也列出来（最新在前）。与最近失败或死信列表相同的 `id` 不重复；有 `work_id` 时打开 `/tasks/:id`。重试中的错误写在行内。`correlation_id` 不参与去重，也不当作任务 id。不新增事件类型。
- 2026-09-23：Batch 13：仪表盘「执行」的重试行在已有 `work_id` 时打开 `/tasks/:id`。同一条执行（相同 id）已作为最近失败显示时，不再在死信列表里重复；`correlation_id` 不参与去重，也不当作任务 id。不新增事件类型。
- 2026-09-23：Batch 12：仪表盘「执行」的最近失败和死信，在触发事件已有任务 id 且 `work_items` 仍有该行时带上 `work_id`，并打开 `/tasks/:id`。`correlation_id` 不当作任务 id。没有关联的行保持纯文本。不新增事件类型。
- 2026-09-22：Batch 11：任务列表把失败且带 `executable_plan`、且不是简报待办的任务留在「进行中」，行上标「可重新执行」。没有计划的失败、已完成和已取消仍在「历史」。未改执行 API。
- 2026-09-22：Batch 10：任务页在 Work 已是 `failed` 且仍可执行时，主按钮与提示改为「重新执行」；`running` 且 handler 失败/死信的旧窗口保持原提示。执行仍走原来的 `executeWorkItem`。
- 2026-09-22：Batch 9：`kernel.expire_stale_running_leases` 在本批行都失败后，对终态死信调用与 Scheduler 相同的 `close_dead_lettered_domain_work`。仍有未结束的 sibling 时不收口；剩余重试不重新入队。不新增事件类型。
- 2026-09-22：Batch 8：调度器把本次执行打成终态死信（超时、重试预算耗尽、租约回收、启动时 interrupted 超限）后，立刻用与启动恢复相同的判定把仍为 running 的领域 Work 收成 `failed`（`WorkItemStatusChanged`）。不新开 retry 预算，不新增事件类型。进程死在这两条事件之间时，下次启动仍走原恢复。
- 2026-09-22：Batch 7 文档对齐 #88–#93：任务页写出审批/恢复/模型成本与「重新执行」；`_recover` 预算耗尽走 `ExecutionFailed` 死信。未改守卫脚本。
- 2026-09-22：`CapabilityFailed(error=interrupted_before_audit)` 带上调用当时的 `execution_id` / `caused_by` / `retry_count`。简报恢复次数按同一次中断对齐，不再用 60 秒窗口。没有这些字段的旧事件仍按 correlation 并入已有 handler replay。
- 2026-09-22：任务页改用与目标页相同的 `page-shell`：整页滚动，宽屏列表+详情，窄屏选中后只留详情并可返回列表。交付指标、执行、验收和返工仍在。窄于 md 的侧栏保持图标栏。
- 2026-09-22：Batch 1：执行 handler 已失败时，仍显示 running 的任务会在启动时收成 failed，不再把后台任务重新排队绕过死信；任务页可对死信中的进行中任务重新执行。
- 2026-09-22：前端 UI 刷新 PR #87（`cursor/frontend-ui-refresh-fcd9`）：tokens 表面层次 + 侧栏分组/收起 + PageHeader/SegmentedControl；主页面视觉统一；lint/tsc/vitest/build/e2e 已绿。无后端/Kernel 改动。
- 2026-09-22：前端依赖范围内 patch/minor 已升（react-query 5.103.2、vite 8.3.0、vitest 5.0.1、eslint 10.11.0 等）；跳过 typescript 7（typescript-eslint 仍要 TS 6 API）与 jsdom 30（engines 要求 Node ≥22.22.2，镜像是 node:20）。
- 2026-09-22：`main` 已包含 #80–#86。简报自己的近 30 日首版采纳、返工、已转任务和评审耗时在 `GET /api/work-items/delivery-metrics`，任务页有评审时展示。审批、恢复和模型成本已能按交付 `execution_id` 归因；无 `caused_by` 的历史简报调用另计次数，不把已归因金额改成 unavailable。全局周期对比、Chat `ask_user`、工具/记忆采纳率仍是另一组指标。
- 依赖 pin 以 `backend/requirements.txt` / `frontend/package.json` / `desktop/package.json` 为准：`openai==3.16.2`、`mcp==2.2.0`、`pypdf==6.19.0`、`cryptography==50.0.1`；前端 React 19.3 / Vite 8 / lucide-react 1.47；桌面 Electron 44。
- 本机若用系统 `mcp` 1.x，mypy 可能误报；lock 钉 `mcp==2.2.0`，CI 用 lock。
- 仍待用户试用：真 LLM、真实邮箱日用。无 Telegram token 时真实收发仍 blocked。soak 默认空库 `data/personal_ai.db`，日用库不在仓库里。

## 近期合并

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-09-22 | 前端依赖 patch/minor：query 5.103.2、router 7.18.4、vite 8.3.0、vitest 5.0.1、eslint 10.11、prettier 3.9.8；传递依赖 brace-expansion 5.0.12、undici 7.29.1 | 未升 typescript 7 / jsdom 30 |
| 2026-09-22 | 文档与代码对齐：重生参考表无 diff；改过期叙事（Electron/Vite/mcp pin、侧栏、WS 失效、桌面启动顺序、测试文件数） | 未改 CI 守卫 |
| 2026-09-22 | Dependabot #69/#72/#73/#76：pypdf 6.19.0、ruff 0.16.8、openai 3.16.2、lucide-react 1.47.0 | #84，未关 Dependabot PR |
| 2026-09-22 | 周期对比写入早安简报，并走通今日页 Playwright | #83 |
| 2026-09-22 | 近 7 日 vs 前 7 日：完成目标、完成任务、新邮件、采纳率 | #82，无新事件类型 |
| 2026-09-22 | `ask_user`：文本回答回到同一 Chat 工具环；取消写入 denied 并不调 LLM | #81 |
| 2026-09-22 | 采纳率汇总工具建议与记忆确认；治理计数读 ApprovalGranted/Denied | #80 |

## 备注

- 2026-09-23：补上 review 的三处缺口：普通任务 running 但还没有 handler 行时补 `ExecuteRequested`（已结束的 handler 不重跑）；执行快照按触发事件匹配调度行；待评审简报按交付事件查找，不再被最新 100 个普通任务挡住。相关测试 51 passed。

- 2026-09-22：简报交付指标 `GET /api/work-items/delivery-metrics` 与任务页近 30 日摘要已接上。首版采纳 = 窗口内首次评审且接受 v1 的任务 / 窗口内完成首次评审的任务。来源编号在中文标点前不再被截进 id。审批、恢复、模型成本按交付 `execution_id` 关联既有事件。

- 2026-09-22：复核 HEAD `7f5b33b`：相关后端 39 / 前端 57 测试及生产构建通过，boundary/layer-deps/concept-growth/dependency-sync 通过；本机已安装依赖落后于新 lock，未跑完整 merge-gate。原 plan 的建议转 Work 已实现；周期对比目前为全局指标、ask_user 为 Chat 续写、采纳率为工具审批+记忆确认，尚不能等同项目简报周期交付/澄清/首版采纳及成本闭环。真邮箱日用仍待验证；本会话另有两份未提交验证测试，真模型试验超时未定位。

- dogfood 周记格式见 `docs/05-engineering/development.md`。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
- 开发期 Alembic squash SOP：`.harness/task-recipes.md` §9
- Windows 提交走 `git -c core.hooksPath=.githooks commit -F`
