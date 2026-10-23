# Personal AI Runtime

单用户、事件溯源的个人 AI 运行时。当前实现把个人数据存于本机，由统一 Kernel 写入，LLM 与工具调用受治理与审计；下一阶段将切换到多设备共享云数据。

当前版本：**1.0.0**（权威源：[`backend/app/version.py`](backend/app/version.py)）

## 快速开始

**前置**：Python 3.12+、Node 20+、npm

```bash
# 交互式安装（推荐首次使用）
bash install.sh
# 或
make setup

# 本地开发（后端 :8000 + 前端 :5173）
make dev
```

启动后访问 http://localhost:5173

**Windows**：见 [`install.bat`](install.bat)（依赖安装）与 [`Makefile.ps1`](Makefile.ps1)。

**Docker**：`docker compose up`（生产需设置 `AUTH_TOKEN`）

**桌面应用**：`make desktop`（开发）/ `make desktop-build`（打包）

## 文档

完整文档入口：[`docs/README.md`](docs/README.md)

Coding Agent 入口：[`AGENTS.md`](AGENTS.md)

| 主题 | 文档 |
|------|------|
| 当前实现快照 | [docs/current-snapshot.md](docs/current-snapshot.md) |
| 共享云数据与多设备 Runtime 方案 | [docs/shared-cloud-runtime-plan.md](docs/shared-cloud-runtime-plan.md) |
| 当前数据模型 | [docs/04-data/data-model.md](docs/04-data/data-model.md) |
| API 参考 | [docs/06-reference/api-endpoints.md](docs/06-reference/api-endpoints.md)（`make docs-gen` 自动生成） |

## 常用命令

```bash
make install      # 安装依赖（无 .env 引导）
make init-db      # Alembic 迁移
make demo         # 填充示例数据
make test-backend # 后端测试
make ci-local     # 本地 CI 门禁
```

## 子系统

| 目录 | 说明 |
|------|------|
| [`backend/`](backend/) | FastAPI + Kernel + Agents + MCP |
| [`frontend/`](frontend/) | React SPA |
| [`desktop/`](desktop/) | Electron 桌面包装 |

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)
