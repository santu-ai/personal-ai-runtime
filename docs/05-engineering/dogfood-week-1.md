# Dogfood Week 1 — 2026-07-29 至 2026-08-04

> 不是"用一下试试"，而是用真实使用压力测试 4 个核心子系统，并每天记录一次"卡点"。
> 这份日志本身就是下一轮重构的输入——参考 [runtime-algebra.md §5.3](../02-concepts/runtime-algebra.md) 的「优先用 dogfood 证据驱动」。

## 起点状态（Day 0 — 2026-07-29 周三）

- 数据库现状：0 work_items、0 conversations、0 memories（数据库尚未创建，绿野状态）
- 已知信号 1：**数据库为空** → 无历史债，从零开始
- 已知信号 2：**无残留数据** → 无数据污染需要处理
- 已知信号 3：__（使用过程中补充）

## 每日最小动作（10 分钟）

1. 早 8:00 检查 `/dashboard` 看 morning_brief 是否触发、内容是否相关
2. 工作中遇到"想记的事" → 用 `/chat` 告诉它（测试 memory extraction）
3. 晚上花 5 分钟记一条："今天哪一步让我烦/卡住/看不懂"

## 重点验证的 4 个假设

| 假设 | 怎么验证 | 期望 |
|------|---------|------|
| A. WorkItem 生命周期正常流转 | Day 3 看 goals 是否有创建→推进→完成闭环；Day 7 统计完成率 | 至少 3 个 goals 走完全流程 |
| B. Memory 提取覆盖足够 | Day 7 看 Memories 页，统计"准确"vs"垃圾"比例 | 准确率 > 70% |
| C. Approval 治理不打扰 | 每天记录 approval 触发次数，标注哪些"问得多余" | 后期 < 3 次/天 |
| D. Morning Brief 有用 | 7 天里它真的帮你看清了当天 / 提醒了 deadline | 主观评分 ≥ 3/5 |

---

## Day 1 (2026-07-29 周三)

### 用了哪些功能
- [ ] Chat
- [ ] Goals（创建/推进/完成）
- [ ] Inbox（poll/digest/分类）
- [ ] Calendar
- [ ] Knowledge（上传/检索）
- [ ] Morning Brief
- [ ] Memory（看 Memories 页）

### 今天的卡点（最重要的 1-3 条）
1. 当我问今天有什么热点新闻时，有昨天的内容。
2. [已修复·待重启验证] 在对话页面刷新后左侧ai图标由每次对话一个头像变成每一次调用工具也会有头像；且调用工具展示的ui也不美观。已修复
3. [已修复·已确认] 通知点开后点其他地方没有收回，确认已修复

### 触发的 Approval 次数 + 是否合理
- 

### 响应速度感受
- 可接受

---

## Day 2 (2026-07-30 周四)

### 用了哪些功能
- [ ] Chat
- [ ] Goals
- [ ] Inbox
- [ ] Calendar
- [ ] Knowledge
- [ ] Morning Brief
- [ ] Memory

### 今天的卡点
1. chat中，问A股信息总是给出错误的信息，经常给出前一天的数据，甚至瞎编（通过tushare现在正常了）
2. token限制，我已经修改了配置文件
3. [已修复·待重启验证] 应该增加一个查看邮件内容的弹出页面在收件箱里面，现在只有ai处理和标记已读。已完成
4. 今天新增了一个mcp tushare，但是设置页面MCP服务器展示不正确（已确认非问题，可忽略）
5. [已修复] 设置页面MCP服务器栏中展示“MCP 服务 2/7 已连接，3 个连接失败。”2个已连接，3个链接失败，那另外两个呢？已完成

### Approval 次数
- 共 1 次，其中 0 次觉得没必要问

### 响应速度
- 可接受

---

## Day 3 (2026-07-31 周五) — 中期检查点

### 用了哪些功能
- [ ] Chat
- [ ] Goals
- [ ] Inbox
- [ ] Calendar
- [ ] Knowledge
- [ ] Morning Brief
- [ ] Memory

### 中期检查：WorkItem 流转情况
- Day 0 起点：0 work_items
- 当前 work_items 总数：__
- goals 创建数：__
- goals 推进到 completed：__

### 今天的卡点
1. 早安简报今天没有生成
2. 设置页面MCP 服务器栏除了数量增加明细，哪些已连接，哪些不可用，不可用原因等等

---

## Day 4 (2026-08-01 周六)

### 用了哪些功能
- [ ] Chat
- [ ] Goals
- [ ] Inbox
- [ ] Calendar
- [ ] Knowledge
- [ ] Morning Brief
- [ ] Memory

### 今天的卡点
1.

### Approval 次数
-

---

## Day 5 (2026-08-02 周日)

### 用了哪些功能
- [ ] Chat
- [ ] Goals
- [ ] Inbox
- [ ] Calendar
- [ ] Knowledge
- [ ] Morning Brief
- [ ] Memory

### 今天的卡点
1.

---

## Day 6 (2026-08-03 周一)

### 用了哪些功能
- [ ] Chat
- [ ] Goals
- [ ] Inbox
- [ ] Calendar
- [ ] Knowledge
- [ ] Morning Brief
- [ ] Memory

### 今天的卡点
1.

---

## Day 7 (2026-08-04 周二) — 最终检查

### Memories 页审视
- 总数：__
- 准确（应保留）：__
- 垃圾（应删除）：__
- 准确率：__%

### Approval 一周汇总
- 总次数：__
- 觉得"问得多余"的次数：__

### Morning Brief 一周评分
- 1 / 2 / 3 / 4 / 5

---

## Week 1 回顾（Day 8 — 2026-08-05 周三 填写）

### 1. 哪个子系统最阻碍日用？
（这是下一个重构 PR 的目标）

### 2. 哪个抽象"看起来重要但实际没用"？
（候选删除——通过 runtime-algebra.md §3.1 Subsumption Test）

### 3. 哪个功能"差一点就好用"？
（产品打磨优先级）

### 4. 从零开始的体验如何？初始启动流程是否顺滑？
（首次初始化 / 数据库创建 / 引导流程评估）

### 5. Review 里指出的债，哪些被 dogfood 证实是"真问题"？
- read_ports/ 拆分：证实 / 不重要
- API 三处混层：证实 / 不重要
- governance/ → context/ 重命名：证实 / 不重要
- test_coverage_*.py 清理：证实 / 不重要
- 其他：__

### 6. 下一周（Week 2）的方向
- [ ] 继续观察（数据还不够）
- [ ] 启动 P2 重构（基于本周证据）
- [ ] 启动未评审领域（async/SQLite、安全、frontend）
- [ ] 其他：__
