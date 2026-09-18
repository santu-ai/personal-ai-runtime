# P0 交付闭环 Review

## 第四轮修复（R3-C，相对 3fac187）

代码已按第三轮要求修复：批准成功后先写入 `aprdis:{approval_id}` 派发意图（含完整工具结果），再领取并删除原始恢复行；仅在 `ExecuteRequested` 已落库或意图标记 `dispatched` 后视为派发完成。进程在领取后、派发前退出时，重试从意图定位缓存结果，跳过工具并补发一次后续执行。同一审批用 asyncio 锁串行化。隔离测试覆盖领取后/派发前中断、派发后/标记前中断、并发审批。相关后端 69 passed。仍未跑完整 merge-gate / 真 LLM / 真实邮箱，不宣称完整 P0 验收通过。

## 最新：第三轮 Review，3fac187（2026-09-18）

本轮结论：R2-B 的 running/ExecuteRequested 窗口已补齐；R3-B 的审批结果保存及普通派发异常重试已补齐。相关后端 37 项测试通过。仍有以下 1 项 P1 恢复缺口，暂不建议宣称完整 P0 验收通过。

### R3-C [P1] 删除审批恢复记录后进程退出，会永久丢失后续派发

位置：`backend/app/core/runtime/handlers/approve_handlers.py:244` 至 `:249`；关联缓存读取条件 `:117` 至 `:127`。

`record_step_success` 成功之后，handler 通过 `take_plan_resume` 将 approval_id 对应行 DELETE 并提交，再调用 `_dispatch_plan_resume`。当前 except Exception 只覆盖可捕获的派发异常，不能覆盖进程退出/终止发生在 DELETE 与 ExecuteRequested 之间的情况。

此时完整结果虽已落盘，但重试时 pending_resume=None，缓存读取被跳过，重新进入 invoke_capability 路径；随后 take_plan_resume 仍为空，不再产生 ExecuteRequested。任务的后续计划因此无法恢复。真实工具是否重复产生效果取决于能力层的审批/幂等处理，本轮没有声称已复现真实外部副作用。

隔离复现使用真实 Kernel 临时数据库及真实 approve handler，stub 工具结果；在恢复记录已删除、派发之前注入 BaseException 模拟不执行异常补偿的进程终止，再重试同一事件。结果：恢复派发 0 次，stub capability 调用 2 次；预期派发 1 次、工具调用 1 次。此为中断边界注入，并非真实进程重启 E2E。

修复要求：approval→action/run/step 的关联及派发意图在确认持久派发前不可丢失；采用可恢复 claim/持久派发状态等机制，重试无需依赖已删除行即可定位成功结果，并区分尚未派发与已经派发。不能仅扩大异常捕获范围来代替崩溃恢复，也不能仅去掉 DELETE 而引入并发重复派发。补删除/领取后、派发前及派发后、清理前的中断测试和并发审批测试。

本轮范围：审查 `3fa88f5..3fac187`；既有相关后端 37 passed，临时补充复现 1 failed（复现后已删除临时文件）；未修改产品代码、未调用真实邮箱/LLM。前端无新增改动，沿用上轮构建验证，未重跑完整 merge-gate。

---

日期：2026-09-17  
审查提交：`041f398`（相对 `5136eec`）  
结论：当前不建议判定 P0 验收通过。发现 6 项需要修复的问题，其中前端构建及恢复链路是阻塞项。

## R1 [P1] 前端生产构建失败

位置：`frontend/src/pages/Tasks.tsx:10`；`frontend/src/pages/Tasks.test.tsx:158`、`:175`、`:179`。

`Tasks.tsx` 从 `api/client` 导入 `WorkDelivery`，但 client 没有转出该类型。新增测试夹具的 `review_status` 还被推导为 string，不能赋给 `WorkDeliveryReviewStatus`。

实测 `npm run build` 退出 1，TS2724 和 TS2345；Vite 打包未执行。单独 Vitest 通过不能替代类型检查/生产构建。

修复验收：统一类型导出与夹具类型，`npm run build` 通过，不通过排除测试文件或放宽业务类型绕过。

## R2 [P1] 返工决定落盘后失败，重复请求无法补齐派发

位置：`backend/app/product/work_delivery.py:449` 至 `:486`，尤其 `:457` 的 replay 提前返回。

返工依次写决定、计划、状态，再清进度并派发。若在决定已提交之后发生异常或进程退出，重复请求会在 `decide_delivery` 读到既有决定并返回 `replayed=True`；`request_rework` 随即返回，不补齐后续步骤。即便换幂等键，当前版本已 changes_requested 的分支仍提前返回。用户可能看到“已要求返工”，实际没有任何新执行。

隔离复现：创建已完成任务及 v1；在 `reset_work_item_plan_progress` 注入异常；重发同一返工请求；`request_work_item_execute` 调用次数为 0。

修复验收：决定与派发使用可恢复的持久状态/幂等机制；在每个写入边界注入中断，恢复后恰好存在一次有效返工派发且意见不丢失。不能只记录决定就把整个请求视为完成。

## R3 [P1] 恢复执行丢失已经完成的资料读取结果

位置：`backend/app/core/runtime/handlers/execute_handlers.py:362`；`backend/app/product/project_brief.py:584`。

执行器从持久化的 resume_from 继续，`PlanRunOutcome.results` 只包含本轮执行的步骤。编译器却只从该列表收集来源。当全部读取已完成、合成前崩溃时，恢复从末尾开始，results 为空，原本已读资料全部消失；中途恢复还可能将后续文件错配到 file_specs 的第一个路径，因为 collect_allowed_sources 的 file_index 每次从 0 开始。

隔离复现：单文件计划，持久进度 resume_from=1；调用实际 `_run_work_plan` 再编译；交付 sources 长度为 0，而非 1。

修复验收：通过持久的完整步骤结果与原步骤索引重建来源，不能依赖短 previous_output；覆盖所有来源已读后重启、部分文件读取后重启、审批恢复、模型失败后重试。禁止无条件重放带外部效果的步骤。

## R4 [P1] 同一版本的相反决定均能成功

位置：`backend/app/product/work_delivery.py:370` 至 `:391`。

只对“再次提交同一种决定”做去重，没有拒绝 accepted → changes_requested 或反向切换。两个仍显示 unreviewed 的页面分别提交验收和返工，会先后成功；锁仅串行化操作，不能保证只接受第一个决定。最后一个事件覆盖验收状态，返工还会实际启动任务。

隔离复现：接受 v1 后，以另一个请求键对 v1 请求返工，未抛 DeliveryConflictError，违反计划中的冲突决定互斥要求。

修复验收：绑定 expected review 状态/版本，已决定版本的相反操作返回 409。另验证幂等键对应的 delivery_id、decision 和请求内容一致，不能把同键不同请求静默当作成功重放。

## R5 [P1] 正文缺少引用仍能标记为合格交付

位置：`backend/app/product/project_brief.py:330` 至 `:339`、`:425`。

校验仅遍历 findings 和 suggested_actions 的引用；summary/content 与 findings 没有一致性约束。模型可以返回包含任意结论或伪造引用的完整正文，同时省略 findings 或返回空数组；missing_cite 保持 0，最终 qualified=True，“每条关键结论附来源”和“不编造来源”均被标记通过。用户主要阅读的正是 content。

隔离复现：允许来源仅 email:real；模型输出 content='Critical claim [email:forged]'、findings=[]；返回 qualified=True。

修复验收：从校验过的结构化结论生成正文，或严格验证正文引用及其与结论的关系；不能仅要求 findings 非空就宣称正文全部有依据。自定义验收条件无法程序检查时显示 needs_review，不能因未检查而默认全部合格。

## R6 [P2] 历史版本入口无法展示完整正文

位置：`frontend/src/pages/Tasks.tsx:318` 至 `:322`、`:452`。

历史版本从 bundle.deliveries 中选取，但后端对该列表调用 include_content=False，只返回摘要与 content_length。点击版本历史仅改变 historyId，没有调用已经提供的 getWorkDelivery 接口。因此正文永久显示“打开详情后显示完整正文”，实际没有继续打开的入口，无法审阅返工前结果。

修复验收：选择历史版本时按 work_id + delivery_id 获取全文，包含加载/错误态，防止快速切换任务/版本串内容。增加两个不同正文版本的 UI 行为测试。

## 验证范围与证据

- 现有相关后端测试：15 passed，覆盖 work_delivery、project_brief、compile、API、execute handler。
- 临时隔离回归用例：4 failed，分别对应 R2–R5；运行后已删除临时测试文件，未修改产品代码。
- 前端 `npm run build`：失败，对应 R1。
- R6：已核对 API 返回结构与前端选择/渲染路径；未做浏览器实测。
- 未运行全量 merge-gate、真 LLM 或真实邮箱；未修改个人数据。
- 当前新增测试未提供真实后端创建→执行→验收→返工→重启的端到端证明；现有 rebuild_all 测试不能替代进程中断恢复验证。修复后需要补齐计划 A2/A3/A4/A8/A10 及真实后端端到端流程，再更新 T4/T5 完成状态。

建议修复顺序：R1 → R2/R3 → R4/R5 → R6 → 合并门禁与真实后端端到端验收。

## 修复状态（2026-09-17）

已按上述顺序落地代码修复，并补回归测试：

| 项 | 处理 |
|---|---|
| R1 | `api/client` 转出交付类型；夹具改为 `WorkDelivery`；`npm run build` 通过 |
| R2 | 决定落盘后仍补齐 notes/重置/派发；`rework_dispatched` 标记保证只派发一次 |
| R3 | `stepres:{action_id}:{step}` 保存完整步骤结果；resume 水合 prefix；文件来源按原步骤索引匹配 |
| R4 | 相反决定 409；幂等键必须匹配 delivery/decision/reason |
| R5 | 扫描 summary/content 引用；空 findings 不合格；自定义条件 `needs_review`；正文由结构化结论生成 |
| R6 | 选择历史版本时 `getWorkDelivery` 拉全文，含加载/错误与取消竞态 |
| R2-B | 派发完成只认本次 decision 之后的 `ExecuteRequested`；running 且未派发时补发，不把 running 当成已派发 |
| R3-B | 批准工具成功后、派发剩余计划前写入完整步骤缓存；重试命中缓存则跳过工具 |
| R3-C | 领取原始恢复行前写入 `aprdis:` 派发意图；确认 ExecuteRequested 或 dispatched 后才视为完成；进程退出窗口可定位缓存并补派发 |

## 第二轮 Review：3fa88f5（2026-09-17）

结论：R1 构建问题已关闭；相反决定/请求键校验、正文校验和历史全文均有修复及相关回归。R2/R3 仍存在以下两个已复现的 P1 缺口，暂不建议通过完整 P0 验收。

### R2-B [P1] running 状态不能作为返工已派发的证据

位置：`backend/app/product/work_delivery.py:605` 至 `:611`。

`request_work_item_execute` 在两个独立 emit 中先写 WorkItemStatusChanged(running)，再写 ExecuteRequested。若中断发生在两者之间，任务已 running，但调度请求不存在。重试返工进入 `_complete_rework_dispatch` 的 running 分支，只补写 rework_dispatched 并返回，把未派发的任务永久标成已派发。

隔离复现：使用真实 Kernel 和真实 request_work_item_execute，仅对 ExecuteRequested 的 emit 注入异常；恢复原 emit 并重试相同请求。结果：ExecuteRequested 数量为 0，rework_dispatched 数量为 1，Work 仍 running。

修复要求：依据绑定本次 decision/run 的持久派发事实或执行记录判断是否已派发，不能依据 Work 展示状态。覆盖 running 写入之后/ExecuteRequested 之前、ExecuteRequested 之后/dispatch 标记之前两个窗口，恢复后既不漏派也不重复。遵守 Kernel 受保护边界。

### R3-B [P1] 审批路径未保存完整步骤结果，恢复后仍漏来源

位置：`backend/app/core/runtime/handlers/plan_runner.py:122` 至 `:130`；关联 `backend/app/core/runtime/handlers/approve_handlers.py:217` 至 `:220`。

新 hydration 只读取成功缓存；正常 plan_runner 成功路径会 record_step_success，但审批批准后的工具在 approve handler 执行，该路径仍只调用 with_step_output（截为 1000 字符），没有记录完整结果，然后从下一步派发。hydration 查不到缓存就静默跳过，因此需要审批的来源在恢复时仍丢失，即使审批工具已成功读到全文。

隔离复现：注册单步 read_file 的 PlanResume；调用真实 on_approve_requested，stub 的工具返回超过 1000 字符正文；用它发出的 ExecuteRequested payload 调用真实 run_plan_steps。结果：outcome.results=[]，应保留的完整来源不存在。

修复要求：批准工具成功后、派发剩余计划前，持久保存与本次 action/run/step 关联的完整结果；确保重试不会重复外部效果。补审批→剩余执行→简报来源的集成测试，以及保存/派发之间中断的恢复测试。缺失缓存时不能静默声称资料已完整恢复。

### 本轮验证

- `npm run build`：通过。
- Tasks 与 Dialog 前端测试：11 passed。
- delivery/project_brief/API/execute/plan_runner 后端相关测试：33 passed。
- 两条临时隔离缺陷复现：2 failed，分别对应 R2-B/R3-B；复现后已删除临时文件。
- 未运行全量 merge-gate、浏览器真实后端 E2E 或真实邮件/LLM。未修改产品代码与个人数据。

## 第三轮修复（R2-B / R3-B）

代码已按第二轮要求修复：

- 返工是否已派发，只看本次 `changes_requested` 之后是否存在 `ExecuteRequested`，以及 `rework_dispatched` 标记。`running` 不再当作完成证据。覆盖 running 写入后/ExecuteRequested 前、ExecuteRequested 后/标记前两个窗口。
- 批准工具成功后先写入完整 `record_step_success`，再派发剩余计划；重试若已有缓存则不再调用工具。审批恢复后 `run_plan_steps` 能水合超过 1000 字符的来源正文。
