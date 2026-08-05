# 高频任务 SOP

> 扩展点权威细节：[`docs/05-engineering/extending.md`](../docs/05-engineering/extending.md)。此处只保留检查命令清单。

## 1. 新增投影器 / 事件类型

确认概念压缩 → Kernel 内 `projectors_*.py` → 注册 →  
`make boundary && make projection-provenance && make rebuild-verify` → 必要时 `make architecture-check` + 同步 docs。

## 2. 新增 Context Fragment

实现于 `backend/app/fragments/` → `register.py` 注册 → 经 Kernel ABI / `read_ports` 读数据 →  
`make test-backend`（含 fragment read boundary 测试）。

## 3. 注册 / 修改 MCP 服务器

外部：`backend/mcp_config.json`；内建：`builtin_registration/` + `builtin_tools/`；策略：`capability_policy.json`（受保护）。  
检查：`make backend-smoke` / `make test-backend`；然后 `make docs-gen` 刷新工具目录。

## 4. 新增 governed 表

`schema_ddl.py` + 分类 → 开发期折叠进 `0001_consolidated`（见 §9；发版后才追加增量 migration）→ 投影经事件写入 →  
`make boundary && make projection-provenance && make alembic-verify` → 同步 `docs/04-data/data-model.md`。

## 5. 修改依赖

同步 `pyproject.toml` + `requirements.txt` → `make dependency-sync` → `make lockfile`。

## 6. 改 API / Makefile 后

`make docs-gen`（重生 `api-endpoints.md` / `tool-catalog.md` / `makefile-targets.md`）→ `make docs-gen-check` 确认不 stale（该目标已在 `BACKEND_CI_STATIC` CI 静态波强制，本地改完也要跑）。

## 7. 概念压缩：指标下降后锁基线

删除/合并事件、fragment、拆分 God object 等**降低** `check_concept_growth` 指标后，把新值锁进基线，否则下次 `architecture-check` 仍按旧上限放行增长：

```bash
make architecture-snapshot                                   # 看当前值
python -m scripts.check_concept_growth --ratchet             # 预览将写入的 baseline + docs §4.4（不写盘，返回 1）
python -m scripts.check_concept_growth --ratchet --yes       # 确认后应用并同步 docs §4.4
```

**注意**：`--ratchet` 自 2026-08 起必须加 `--yes` 才写盘；无 `--yes` 只是 dry-run 预览。

## 8. 全量修复后的闭环复核（防漏项）

架构评估/尽调给出的问题清单修完后，不要直接收工。做一次**逐项对照复核**，能抓到"自认为修了但实际漏掉"的项（本次漏掉了 `read_ports.get_work_item` 别名删除，就是复核抓到的）：

1. **逐项对照 plan/报告**：每个问题 → 源码里找到对应修复 + 防回归（pytest 断言或静态守卫）。找不到防回归的修复视为未完成。
2. **grep 断言全仓清零**：对"统一/删除"类目标（如 `parent_goal_id`、已删别名、死字段），用磁盘扫描（`Get-ChildItem | Select-String`）断言只剩历史迁移/文档白名单，别信 IDE grep 索引。
3. **跑完整验证矩阵**：静态守卫（boundary / layer-deps / concept-growth / event-schema / unused-config / projection-provenance）+ 后端 pytest + rebuild-verify + 前端 test + docs-gen。
4. **概念指标变化零和登记**：指标因修复净增（如新增执行可信化功能）时，同步 `BASELINE` + `docs/02-concepts/runtime-algebra.md` §4.4 + `SUBSYSTEM_LOC_BUDGETS`，并说明替代的旧概念/为什么净增合理。
5. **复核报告**：按严重度列出"已闭环 / 部分闭环 / 漏项"，漏项给明确处置（删或注明 ABI 保留），不要让"部分闭环"悬空。

## 9. 开发期合并 Alembic（squash）

开发阶段不需要兼容旧库时，把增量 revision **折叠回唯一** `0001_consolidated`，避免长链与双真相：

1. 以 [`schema_ddl.py`](../backend/app/store/schema_ddl.py) 为列真相，改写 [`0001_consolidated.py`](../backend/alembic/versions/0001_consolidated.py) 的 `upgrade`/`downgrade`。
2. **删除**全部增量 revision；不要留空 `upgrade` 或仅兼容分支。revision id 保持 `0001_consolidated`（`down_revision=None`）。
3. 本地删 `data/personal_ai.db`（及 `-wal`/`-shm`）后重启，让 Alembic 重建；旧 `alembic_version` 无法线性回退。
4. 自证：`python -m scripts.verify_alembic` + schema contract 双路径测试（`test_projection_schema_contract` / `test_schema_init`）。
5. 同步 [`docs/04-data/data-model.md`](../docs/04-data/data-model.md)（权威叙述）。

正式发版后若需兼容用户库，再改为只追加增量 migration，禁止再 squash 已发布 head。
