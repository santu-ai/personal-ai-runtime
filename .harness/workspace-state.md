# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`main`
- 进行中任务 / WIP：无（11 个 Dependabot 分支已合并进 main）
- 已知坏点 / 待办：Memory 2 条 proposed 未 ratify（不代用户确认）；审批续写仍 one-shot（ADR-R011，不推翻）
- 最近审阅：2026-08-18 合并 Dependabot；后端 1457 passed、前端 210、桌面 23；已重生 requirements.lock

## 本机环境

### Windows（2026-08-17 本会话）

- 仓库根 `.venv`（PowerShell 5.1）；命令走 `Makefile.ps1`，不用 bash `&&` / heredoc
- 未跟踪过程笔记：`.agent-work/`（非架构 SSOT，未纳入提交）

### macOS Intel x86_64, 13.7.8 — 2026-08-16 主开发接手

- venv：`backend/.venv`（Python 3.12.10）；frontend/desktop 已 `npm ci`
- **cryptography 例外**：PyPI 49.0.0 无 Intel macOS wheel，本机 venv 装的是 **45.0.6**（universal2 wheel，API 兼容，测试全绿）；仓库 lock 仍是 49.0.0。本机勿跑 `make install`（会重装 49.0.0 失败）；若正式降级需走三步锁文件纪律（requirements.txt + pyproject.toml → dependency-sync → lockfile）
- **SENSITIVE_OPS_LOCAL=false** 已写入根目录 `.env`：`_SENSITIVE_PATTERNS` 含 `/Users/` 正则，macOS 本机路径会误触发 high risk（Linux CI 不受影响）；5 个测试（test_taint 1 + eval/benchmarks 4）依赖此设置
- 基线：`make test-backend` 等价 1411 passed / 3 skipped / 4 deselected；boundary / layer-deps / concept-growth 全过
- 根目录 `.env` 已配置真实 DeepSeek key；Gmail 已写入运行时 settings（R2 Inbox 通）

## 产品观察（后续规划候选）

- Wave B 续：Telegram 双向网关
- 可选：proposed 过期自动拒绝（用户未选）
- God Object（`query_builder`/`main`/`mcp_mesh`/`agent_scheduler`）受概念压缩约束，不能无配对拆文件；优先单文件内 helper（见 conventions）。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-08-18 | 闭环：retrying→in_retry；CI/venv MCP smoke；LLM 遥测+egress 脱敏；监控 CAS/通知去重/连接器 DATA_DIR/SSE 取消；输入上限；lazy markdown 与桌面路径单测 | merge-gate 等价通过 |
| 2026-08-17 | 执行信任汇总并入 `read_ports/events.py`（不新增 runtime 文件）；审批恢复要求会话/tool-call 身份 | 本提交未推送 |
| 2026-08-17 | 记忆转化率按记忆 ID 的最新 Claim 决策去重；新增执行信任读端口测试和产品边界守卫 | 后端全量 1450 passed / 9 skipped / 5 deselected；lint、boundary 通过 |
| 2026-08-17 | 修复审批恢复的会话/tool-call 身份误匹配；执行信任汇总下沉到 read_ports；修复前端 ES2020 类型错误 | merge-gate 全部通过：1447 backend / 203 frontend tests，build、boundary、layer-deps、projection-provenance、rebuild-verify OK |
| 2026-08-17 | 统一 NoticeBanner/ToastCard；Chat 重载恢复审批卡；trust-loops e2e 覆盖首页发送/审批恢复/inbox 重试/proposed 确认 | 本提交未推送 |
| 2026-08-17 | 记忆拒绝原因进 ClaimRejected payload，review 可恢复并看转化率；今天页展示执行失败/重试/死信 | 本提交未推送 |
| 2026-08-17 | 收件箱页展示最近同步时间/结果/失败原因与重试；7 日轮询/重复/已读同步指标从事件重建 | 本提交未推送 |
| 2026-08-17 | 词法折叠 `..` 堵住 filesystem 穿越；日志测试不再依赖顺序；新增 `merge-gate` | 已提交 `5775ac3` 未推送 |
| 2026-08-17 | addError 同步打 console.error；收件箱轮询失败写 warning 且进页不再吞错 | 本提交 |
| 2026-08-17 | 工具 JSON 不再被 8000 字截成非法串；收件箱轮询才能写入最近邮件 | 本提交 |
| 2026-08-17 | 收件箱轮询同步最近已读邮件，不再只拉 UNSEEN | 本提交 |
| 2026-08-17 | 收件箱最近邮件列表封顶 20 封 | 本提交 |
| 2026-08-17 | 收件箱在摘要下展示全部邮件列表 | 本提交 |
| 2026-08-17 | 确认条两侧随背景；首页回车即发送；审批中断持久化 tool_calls | 本提交 |
| 2026-08-17 | 审批卡/错误页/今日待办改 lucide；收件箱摘要去掉 emoji 前缀 | 已提交 `49c3c29` 未推送 |
| 2026-08-17 | 确认条收窄；通知铃二次点击关闭；侧栏新对话改成整行按钮 | 本提交未推送 |
| 2026-08-17 | Context live A/B：bm07b 编译对照 + e2e_live 真 LLM 邮件 nonce | 已提交 `135aabf` 未推送 |
| 2026-08-17 | 日用库 `verify_vector_consistency`：27 条记忆 SQLite↔Chroma 一致 | 只读对账，无代码改动 |
| 2026-08-17 | 工具/时间线/引导页/记忆分类改 lucide；describeArgs 去掉 emoji 前缀 | 已提交 `0a852bc` 未推送 |
| 2026-08-17 | 上下文收进顶栏；Chat lucide；概览「今天」；主按钮 insight；记忆角标直达 review | 已提交未推送 |
| 2026-08-17 | 侧栏常驻数据导航；首页底部真输入条；吐司避开顶栏 | 已提交 `f148ebf` 未推送 |
| 2026-08-17 | Chat 待确认记忆条与上下文按钮分层，避免右上角重合 | 已提交 `27067b6` 未推送 |
| 2026-08-17 | 仪表盘 recent_memories 走 `recall_memories_for_context` | 已提交 `918a707` 已推送 |
| 2026-08-17 | 公开 `GET /memories/search` 走 claim 过滤召回；抽取去重仍用未过滤 Chroma | 已提交 `b8700a6` 未推送 |
| 2026-08-17 | 首页只计 ratified；Desktop/Vite/CORS 默认 IPv4 回环 | 已提交 `e26849a` 未推送 |
| 2026-08-17 | 审批 deny 持久化 tool result + 会话说明（不调 LLM） | 已提交 `937a97e` 未推送 |
| 2026-08-17 | Chat/Home 内联确认 proposed；ChatRequested max_retries=2；真 LLM Chat+write_file 审批 deny | 已提交 `b539b45` 未推送 |
| 2026-08-17 | W34：email 应用 miss 记 CapabilityFailed；pending→completed 用户捷径；勾选子项重算父进度；soak 找对 SQLITE_PATH；Vite 绑 0.0.0.0 | 已并入 `b539b45` |
| 2026-08-17 | 测试隔离：pin SQLITE_PATH + 重绑 runtime_config.settings；防止 app_settings 写入日用库 | 已推送 `315541f` |
| 2026-08-16 | W33 日用修复：抽取降噪；简报用 pending 邮件计数且不铺 proposed 内容；Chat 待确认横幅；pending→completed 改 400；审批缺 decision 改 422；会话 JSON title；项目根豁免 /Users 敏感误伤 | 本提交 |
| 2026-08-16 | W33-R2 dogfood：Chat/Memory/Work/Desktop/Inbox 全 pass；Memory 需 ratify 后新会话才能召回 | 记录在 `.harness/dogfood/2026-W33.md` |
| 2026-08-16 | 修复 macOS 系统级 symlink（/tmp→/private/tmp）导致 FILESYSTEM_ALLOWED_DIRS 词法校验全拒；显式配置改为追加项目根；symlink 检查改为沿 lexical 根 walk（不先 resolve），堵住 alias 根下 planted symlink 逃逸；+回归测试 | commit `39b9da4` 未推送 |
| 2026-08-13 | 体检 Now 批次：cap_intent 意图+chat 幂等键（E-10/E-11）；url_monitors/inbox 旁路收编+layer-deps R5；单实例文件锁；interrupted 计入 retry 预算；INV-C1/C4/W6 文档校正 | 本提交推送 |
| 2026-08-07 | 记忆 triage：bulk/筛选/count + extractor 减流入（含 distance 去重修复） | commit `59b66c6` |
| 2026-08-06 | Tasks：执行日志 + plan 预览确认；needs_user 建议话术全覆盖 | 前端 |
| 2026-08-06 | harness：TimerFired / APP_STORAGE merge / Monitor SOP | commit `e555558` |
| 2026-08-06 | Inbox Filter Monitor：poll 后求值 + Dashboard 监控 tab | 零新事件/表 |
| 2026-08-06 | Wave A：Tasks/claim review/建议 UX；召回 over-fetch + proposed count 修复 | 准备推送 |
| 2026-08-05 | Alembic 压回唯一 `0001`（对齐 schema_ddl）；删 6 增量；harness §9 + conventions | verify_alembic OK；准备提交 |
| 2026-08-05 | 单文件优化：query_builder safe_*；cancel/denied/timer/lifespan 去重 | commit `6c3dc28` |
| 2026-08-05 | 收口审查遗留：payload upcast；alembic 链守卫；desktop/docs | commit `ac9abb5` |
| 2026-08-05 | P0：删休眠子系统；执行可信/白名单；ADR-R017 | commit `fddafb3` |

## 备注

- dogfood 记录约定（周记格式）仍见 `docs/05-engineering/development.md` §自用检查。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
- 开发期 Alembic squash SOP：`.harness/task-recipes.md` §9
