# Personal AI Runtime 文档

当前版本：`1.0.0`（权威源：[version.py](../backend/app/version.py)）。

本目录已于 2026-10-23 按当前代码重新建立。历史架构说明和历史 ADR 已移除，不能再作为实现依据。

当前只有两类权威信息：

1. [当前实现快照](current-snapshot.md)：描述 HEAD `61f3e3bc` 已经存在的行为。
2. [共享云数据与多设备 Runtime 方案](shared-cloud-runtime-plan.md)：描述准备实施的目标、与当前实现的差距，以及重构顺序。

补充参考：

- [当前数据模型](04-data/data-model.md)
- [API 端点参考](06-reference/api-endpoints.md)，由代码生成
- [工具与能力目录](06-reference/tool-catalog.md)，由代码生成
- [Makefile 目标参考](06-reference/makefile-targets.md)，由代码生成

阅读时必须区分“当前实现”和“目标方案”。目标方案中的表、字段和行为在代码落地前都不属于当前事实。代码变化后，先更新当前快照；架构决定变化后，再更新目标方案。
