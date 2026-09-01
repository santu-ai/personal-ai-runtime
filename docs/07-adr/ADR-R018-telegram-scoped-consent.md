# ADR-R018：Telegram 本地网关与 scoped consent

- 状态：Accepted
- 日期：2026-09-01

## 决策

Telegram 入站采用 FastAPI 单进程内的 Timer long-polling，不新增 worker、消息总线、
governed 表或事件类型。网关状态存放于 APP_STORAGE `app_settings` 的
`telegram_gateway` category；token 与 chat id 只从环境变量读取。

入站仅接受 `TELEGRAM_CHAT_ID`，使用 `telegram:{update_id}` 作为 correlation，
并在 emit `ChatRequested` 前查询同 correlation 防重复。消息被视为外部不可信输入，
后续写能力继续受 taint 与审批约束。

`telegram_send` 始终保持 high risk。关闭自动回复时，每条回复产生人工审批；显式开启
auto-reply 后，只能针对配置的 chat id，为每条精确回复创建并立即消费一次
pre-approved approval。每次发送仍保留 `ApprovalRequested/Granted`、Capability 与
egress 审计，不形成对其他 chat id 或其他写能力的长期授权。

## 后果

- 单一控制面与 Kernel ABI 不变，重启后 offset/会话状态可恢复。
- Telegram API 失败使用有上限的指数退避；凭据不会进入数据库、API 返回或日志。
- Bot API 无事务性 exactly-once；系统保证入站确定性去重，发送侧保留审计并按运行时
  handler 的至少一次语义处理。
