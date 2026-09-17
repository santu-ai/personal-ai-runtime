# P0 交付闭环 Review

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

未跑全量 merge-gate、真 LLM 或真实邮箱。
