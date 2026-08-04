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

`schema_ddl.py` + 分类 → alembic 迁移 → 投影经事件写入 →  
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
