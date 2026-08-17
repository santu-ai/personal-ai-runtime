# Makefile 目标参考

> **自动生成** — 由 [`scripts/gen_makefile_targets.py`](../../backend/scripts/gen_makefile_targets.py) 从根 [`Makefile`](../../Makefile) 解析。不要手工编辑目标表。
> 重新生成：`cd backend && python -m scripts.gen_makefile_targets`。

Windows 子集见 [`Makefile.ps1`](../../Makefile.ps1)。

| 目标 | 首条命令摘要 |
|---|---|
| `install` | `python3 -m pip install --require-hashes -r requirements.lock` |
| `setup` | `bash install.sh` |
| `init-db` | `python3 -m alembic upgrade head 2>/dev/null \|\| echo "DB will auto-init on first run"` |
| `install-hooks` | `bash scripts/install_hooks.sh` |
| `dev` | `@echo "Starting backend (8000), waiting for health, then frontend (5173)..."` |
| `demo` | `LLM_API_KEY=$${LLM_API_KEY:-demo-seed} python3 -m scripts.seed_demo` |
| `screenshots` | `cd docs/assets && npm install && npx playwright install chromium && npm run screenshots` |
| `test` | `(no recipe / meta target)` |
| `test-backend` | `python3 -m pytest tests/ -q -m "not live_llm"` |
| `test-backend-coverage` | `python3 -m pytest tests/ -v --cov=app/core/runtime --cov=app/core/harness --cov=app/api --cov-rep...` |
| `test-live` | `RUN_LIVE_LLM=1 python3 -m pytest tests/e2e_live/ -v -m live_llm` |
| `test-frontend` | `frontend: npx tsc --noEmit && npm test` |
| `frontend-build` | `frontend: npm run build` |
| `merge-gate` | `@echo "merge-gate checks passed"` |
| `test-e2e` | `frontend: npx playwright install chromium && npm run test:e2e` |
| `lint` | `ruff check app/` |
| `typecheck` | `python3 -m mypy app/ scripts/ --ignore-missing-imports` |
| `dependency-sync` | `python3 -m scripts.check_dependency_sync` |
| `backend-ci-static` | `@echo "backend-ci-static checks passed"` |
| `backend-ci-runtime` | `@echo "backend-ci-runtime checks passed"` |
| `backend-ci-core` | `$(MAKE) -j$(JOBS) backend-ci-static` |
| `ci-local` | `@echo "ci-local checks passed"` |
| `test-e2e-real` | `frontend: npx playwright install chromium && npm run test:e2e:real` |
| `backend-compileall` | `python3 -m compileall app/ -q` |
| `backend-smoke` | `python3 -m scripts.verify_api_mcp_smoke` |
| `desktop` | `desktop: npm start` |
| `desktop-test` | `desktop: npm test` |
| `desktop-build` | `desktop: npm run build` |
| `boundary` | `python3 -m scripts.check_boundary` |
| `layer-deps` | `python3 -m scripts.check_layer_deps` |
| `layer-deps-inventory` | `python3 -m scripts.check_layer_deps --inventory` |
| `layer-deps-strict` | `python3 -m scripts.check_layer_deps --strict` |
| `docs-links` | `python3 -m scripts.check_doc_links` |
| `docs-table-sync` | `python3 -m scripts.check_doc_table_sync` |
| `docs-line-refs` | `python3 -m scripts.check_doc_line_refs` |
| `docs-numbers` | `python3 -m scripts.check_doc_numbers` |
| `docs-gen` | `python3 -m scripts.gen_api_docs` |
| `docs-gen-check` | `python3 -m scripts.gen_api_docs --check` |
| `except-hygiene` | `python3 -m scripts.check_except_hygiene` |
| `policy-consistency` | `python3 -m scripts.check_capability_policy_consistency` |
| `version-sync` | `python3 -m scripts.check_version_sync` |
| `boundary-inventory` | `python3 -m scripts.check_boundary --inventory` |
| `boundary-strict` | `python3 -m scripts.check_boundary --strict` |
| `execution-ownership` | `python3 -m scripts.check_execution_ownership` |
| `execution-ownership-inventory` | `python3 -m scripts.check_execution_ownership --inventory` |
| `execution-ownership-strict` | `python3 -m scripts.check_execution_ownership --strict` |
| `architecture-check` | `python3 -m scripts.check_concept_growth` |
| `architecture-check-strict` | `python3 -m scripts.check_concept_growth --strict` |
| `architecture-snapshot` | `python3 -m scripts.check_concept_growth --snapshot` |
| `architecture-record` | `python3 -m scripts.check_concept_growth --record` |
| `event-schema` | `python3 -m scripts.check_event_schema` |
| `event-schema-snapshot` | `python3 -m scripts.check_event_schema --snapshot` |
| `event-schema-record` | `python3 -m scripts.check_event_schema --record` |
| `unused-config` | `python3 -m scripts.check_unused_config` |
| `non-sovereign-attachments` | `python3 -m scripts.check_non_sovereign_attachments` |
| `single-process-control-plane` | `python3 -m scripts.check_single_process_control_plane` |
| `dynamic-imports` | `python3 -m scripts.check_dynamic_imports` |
| `dashboard` | `python3 -m scripts.health_dashboard` |
| `dashboard-write` | `python3 -m scripts.health_dashboard --write` |
| `projection-provenance` | `python3 -m scripts.check_projection_provenance` |
| `conversation-rebuild` | `python3 -m scripts.verify_conversation_rebuild` |
| `goal-rebuild` | `python3 -m scripts.verify_goal_rebuild` |
| `work-items-goal-rebuild` | `python3 -m scripts.verify_work_items_goal_rebuild` |
| `rebuild-verify` | `python3 -m scripts.verify_rebuild` |
| `export-roundtrip-verify` | `python3 -m scripts.verify_export_roundtrip` |
| `snapshot-verify` | `python3 -m scripts.verify_snapshot_rebuild` |
| `egress-verify` | `python3 -m scripts.verify_egress` |
| `vector-consistency-verify` | `python3 -m scripts.verify_vector_consistency` |
| `memory-lifecycle-verify` | `python3 -m scripts.verify_memory_lifecycle` |
| `inbox-audit-verify` | `python3 -m scripts.verify_inbox_audit` |
| `memory-repair-verify` | `python3 -m scripts.verify_memory_index_repairs` |
| `tool-calls-audit-verify` | `python3 -m scripts.verify_tool_calls_audit` |
| `alembic-verify` | `python3 -m scripts.verify_alembic` |
| `docker-up` | `docker compose up --build` |
| `docker-down` | `docker compose down` |
| `lockfile` | `python3 -c "import piptools" 2>/dev/null \|\| python3 -m pip install --user pip-tools==7.5.3` |
| `secrets-scan` | `@gitleaks detect --config .gitleaks.toml --source . --no-banner --redact \|\| \` |

完整配方以根 `Makefile` 为准；本表仅作索引。
