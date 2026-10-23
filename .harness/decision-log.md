# 当前架构决定摘要

> 旧 ADR 已随历史文档删除。当前目标的完整论证在 [共享云数据与多设备 Runtime 方案](../docs/shared-cloud-runtime-plan.md)；下表只用于快速判断改动方向。

| 决定 | 影响 | 状态 |
|---|---|---|
| 云端共享数据是唯一的跨设备协调媒介 | Runtime 之间不直接调用，不引入中央 scheduler | 已确认 |
| 每台设备只保证本机单实例 | 保留本机进程锁；跨设备一致性全部由 PostgreSQL 事务、唯一键、lease 和 fencing 提供 | 已确认 |
| 开发期直接替换存储，不迁移旧数据 | 不做旧数据兼容；PostgreSQL + pgvector 是本次推荐的具体实现 | 用户确认可替换存储；技术选型为建议 |
| 延续现有 Work、`handler_executions`、Kernel 与 Capability governance | 不建立第三套 task/job/agent 总线；现有执行表扩展为共享 claim | 已确认 |
| 本地应用通过 Application / Connection / DeviceBinding 接入 | 建议凭据留在系统凭据库，逐设备授权；内建目标应用仍可独立存在 | 应用接入方向已确认，具体 schema/凭据策略为建议 |
| 外部效果使用幂等与对账 | 网络结果不确定时进入 `unknown`，不能用 lease 宣称严格 exactly-once | 已确认 |

旧的“分布式 lease / 多 worker 是非目标”决定已被替代。代码中的对应 fitness rule 和 guard 需要在共享执行阶段一起重写。
