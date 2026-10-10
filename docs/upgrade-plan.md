# 升级路线

本文件是后续若干轮的工作路线，不是第二套架构说明。当前行为以代码和 [01-overview/](01-overview/architecture.md) 为准。Kernel ABI 保持稳定；改动留在 Product、既有 Work 合约、read ports 和 UI。

判断：运行时地基（事件溯源、能力治理、执行恢复、交付版本 → 验收 → 返工 → 建议转任务）已经够用。下一阶段做成**可信、能持续交付的个人工作助手**。优先数据出口、带证据的简报、以及真实日用验证。不优先加工具或页面。

主场景：持续跟踪一个项目，把邮件和本地文件收成有出处的进度、风险和待办，并留下每次交付的变化和验收记录。

外部评审对照的是 commit `4b11a82`。下面每条都按当前代码复核过。

## 对照

只借能力，不排座次。和本仓库真正可比的是：单用户、本地优先、带记忆和工具的个人助手，以及「把资料收成可核对交付物」的那一层。Dify、OpenHands、LangGraph、n8n 是相邻系统，用来借循环、审批和评测，不借多用户工作流平台。

| 能力 | 本仓库现在 | 值得借的做法 | 来源 |
|---|---|---|---|
| 代理循环 | Brain 工具环，默认最多 10 轮；审批可暂停并回到同一环 | 持久身份跨会话；工具级暂停/继续，动作和参数一起给人看 | [Letta stateful agents](https://docs.letta.com/concepts/stateful-agents/index.md)、[n8n human-in-the-loop](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md) |
| 记忆 | 事件溯源记忆 + Chroma 召回；提取后待确认 | 核心记忆钉在上下文里，档案记忆按需语义检索；用跨会话任务结果证明记忆有用，而不是只展示记忆页 | [Letta memory](https://docs.letta.com/guides/core-concepts/stateful-agents/index.md)、[Letta archival memory](https://docs.letta.com/v1-sdk/memory/archival-memory/) |
| 知识与出处 | 项目简报按最近邮件和指定文件收集，引用只核 ID | 知识库可浏览，文本检索和语义检索一起用；覆盖范围决定交付质量 | [Open WebUI knowledge](https://docs.openwebui.com/features/workspace/knowledge/)、[Khoj search](https://docs.khoj.dev/features/search) |
| 工具 / MCP | 内建工具注册 + 外部 MCP 网格，3-gate 审批 | 按服务器挂工具，而不是把每个工具摊平；stdio 只允许管理员配置 | [LibreChat MCP](https://www.librechat.ai/docs/features/mcp)、[LibreChat agents](https://www.librechat.ai/docs/features/agents) |
| Provider | OpenAI 兼容客户端 + 多 provider fallback；本地与否必须看目标地址 | 一个配置面切换本地和在线模型，连接测试和正式调用走同一出口判定 | [AnythingLLM desktop assistant](https://docs.anythingllm.com/desktop-assistant/introduction)、[Khoj self-host](https://docs.khoj.dev/get-started/setup) |
| 桌面入口 | Electron 拉起后端；打包前复制前端产物 | 缩短「装好 → 做完第一件任务」的距离 | [AnythingLLM desktop assistant](https://docs.anythingllm.com/desktop-assistant/introduction) |
| 评测 | 结构校验（引用 ID 在允许集合内）+ 大量回归测试；没有固定的简报语义评测集 | 矛盾材料、未知日期、缺失预算这类案例要能判失败 | 本仓库缺口，见阶段 2 |
| 明确不借 | — | 通用工作流画布、多用户、大批连接器、只为缩小文件的重构 | [Dify](https://docs.dify.ai/) 一类产品的平台形态；[OpenHands](https://docs.openhands.dev/) 的编码代理和 [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) 只在阶段 4 以后、日用失败日志指向它们时才考虑 |

Mem0（[memory overview](https://docs.mem0.ai/open-source/overview)）适合当作记忆层参考，不适合替换本仓库的事件溯源记忆。

## 复核过的缺口

| # | 评审结论 | 代码复核 | 本轮 |
|---|---|---|---|
| 1 | `provider_is_local("ollama", "https://remote.example.invalid")` 为真，远程 Ollama 绕过云端个人上下文限制；普通邮件没有特殊标记时被分成 `general` | **确认。** 旧逻辑先看类型 `ollama` 就返回本地。`classify_llm_payload` 只认身份面、记忆标记和轨迹词，邮件正文和文件正文没有这些标记就是 `general`。切换模型和 fallback 都会调用 `provider_is_local`，所以修函数本身能覆盖这些路径，但仍要有测试锁住每个候选地址 | 阶段 1，本 PR |
| 2 | 简报可能漏掉关键材料：先取最近 30 封再按关键词和时间过滤，只用预览，文件 500 行 | **已改。** 计划把 `since` 和可选 `query` 交给 `check_inbox`，邮箱先检索再截断，命中封带正文。文件窗口默认 2000 行，交付写明截断 | 阶段 2 |
| 3 | 校验器只检查引用 ID 在允许集合里，看不到来源正文；合法 ID 配上编造结论也会 `qualified=True` | **已改结构与证据分开。** `qualified` 仍只表示结构检查。摘录对不上来源时 `quality_evidence=unsupported`，不把结构打成失败；人还没核对前是 `pending` | 阶段 2 |
| 4 | `needsFrontendBuild()` 只看产物在不在和资源路径，不看来源是否更新；发布工作流不打桌面包 | **前半在 #361。** 新鲜度改为比较源码与两份产物的修改时间。**后半在 #362 完成：** [`release.yml`](../.github/workflows/release.yml) 调用 [`desktop-windows.yml`](../.github/workflows/desktop-windows.yml)，构建 Windows 安装包，并在另一台干净 runner 上安装、确认应用和内嵌后端响应后再上传 | 打包检查在 #361；Windows 发布与干净安装验证在 #362 |
| 5 | 引导停在「开始第一次对话」 | **已改。** 第三步选一个邮件场景，创建项目简报并打开任务，后续仍走执行、核对、验收和预约 | 阶段 3 |

没有推翻的架构结论：事件溯源、统一能力治理、执行恢复、交付版本循环都还在，而且应该留着。没有发现评审所依据的出口函数或打包检查已经在 `4b11a82` 之后被修掉；本仓库当前 HEAD 就是这个提交。

另外两处和评审方向一致、但评审没有单独列成条目：

- 局域网地址（例如 `192.168.1.8`）以前会因为类型是 `ollama` 被当成本地。字节已经离开本机，现在按远程处理。只有回环（`localhost`、`127.0.0.0/8`、`::1`）算本地。
- 没有标签的普通句子，哪怕在谈论邮件，仍然是 `general`。这是故意的：身份提示词里出现「记忆」曾经把每一轮云端对话都拒绝掉。邮件和文件只认显式 `data_sources`。

## 阶段

每一阶段都应该能单独合并。Kernel、`capability_policy.json`、`taint.py`、`check_boundary.py` 不动。

### 阶段 1 · 可靠基线（本 PR）

远程目标不能被判成本地；声明过的邮件和文件正文在未允许时不能离开本机；源码变更必须进入安装包的前端产物。

- 出口按实际目标地址判定，覆盖模型切换和 fallback。
- 项目简报、收件分类、邮件摘要，以及 `check_inbox` / `read_inbox_email` / `read_file` 的工具结果（含历史回放和审批续写）带上 `email` 或 `file` 标签。
- 桌面预构建比较源码时间与 `frontend/dist`、`desktop/frontend-dist`。
- Windows 发布工作流做可复现构建，并在干净环境验证安装和启动（#362）。

风险：已把远程 Ollama 当成「本地」来用的人，在默认禁止云端个人数据时，带记忆或带邮件/文件的回合会变成 `EgressDeniedError`。这是要的失败，不是静默外发。`ALLOW_CLOUD_PERSONAL_DATA_EGRESS=true` 仍可显式放开。回环上的 Ollama 行为不变。

收益：个人上下文和邮箱/文件正文不再因为 provider 类型名叫 ollama 就发到远程主机。第二次打桌面包不会悄悄装上过期前端。

### 阶段 2 · 可信简报

先按范围检索，再读命中的全文；交付物写明检索范围、截断和缺口。质量状态拆成「结构检查通过」「证据支持待核对」「用户已验收」。每条关键结论带上来源片段和位置。固定评测集不少于 30 例，覆盖漏召回、矛盾材料、截断和未知项。

风险：检索变宽会让简报更慢、上下文更大，要沿用现有工具结果外溢，不新造事件类型。

收益：合法引用 ID 不能再把编造结论标成合格。

### 阶段 3 · 日用闭环

引导改成：选一个场景 → 接上来源 → 生成第一份交付 → 核对来源 → 验收 → 预约下一次。表面展示待验收和失败恢复。给单次任务加上费用上限。用 14 天试用记录成功率、第一版验收率、人工核对时间和每份被接受交付的成本。

风险：引导和调度都走现有 Work 合约，不新开一条任务模型。

收益：装完之后的第一件事是一份可验收的项目简报，而不是一场空对话。

### 阶段 4 · 按证据扩展

只根据日用失败日志加一个高价值连接器，或第二份交付模板。同时用跨会话任务看记忆有没有帮上忙。没有失败证据就不加连接器，也不做画布、多用户或大规模接入。

2026-W33 到 2026-W36 的日用记录里，没有一条失败指向缺连接器或第二份交付模板。Telegram 真实收发在 W36 记为 blocked，是因为本机没有配令牌、会话号，也没有打开 telegram 这一类内建工具；mock 已通过，连接器本身在。W33 的早安简报信噪和 W34 的召回偏向旧暗号，都落在已有简报和记忆上。本轮因此不加连接器，也不加第二份模板。跨会话评测看后一轮任务拿到的记忆上下文：相对空记忆库，是否带上当前事实，并排除未确认、已拒绝、衰减和已被取代的事实。

风险：新连接器必须走现有 MCP / capability 治理，不能绕过 Kernel。

收益：扩展跟着真实缺口走。

## 后续轮次清单

做完一项就把 `[ ]` 改成 `[x]`，并在同一行注明 PR。

### 阶段 1

- [x] 远程 Ollama 按目标地址判定，回环仍为本地（#361）
- [x] 邮件 / 文件显式数据源标签，模型切换与 fallback 各自复判（#361）
- [x] 桌面打包发现过期前端源码（#361）
- [x] Windows 发布工作流：可复现构建，并在干净环境验证安装和启动（#362）

### 阶段 2

- [x] 简报先限定检索范围，再读命中邮件的正文，而不是只拿最近 30 封的预览（#363）
- [x] 文件读取不再以固定 500 行作为唯一窗口；交付物写明截断（#363）
- [x] 交付物展示检索范围、截断和缺口（#363）
- [x] 质量状态拆成结构通过 / 证据待核对 / 用户已验收（#363）
- [x] 每条关键结论带上来源片段和位置（#363）
- [x] 不少于 30 例的固定评测：漏召回、矛盾、截断、未知日期或缺失预算（#363）

### 阶段 3

- [x] 引导走到第一份可核对的交付，而不是停在第一次对话（#364）
- [x] 预约下一次运行，并给出相对上一份的变化摘要（#368）
- [x] 待验收和失败恢复出现在日用表面上（#365）
- [x] 单次任务费用上限（#366）
- [x] 14 天试用记录：成功率、第一版验收率、人工核对时间、每份被接受交付的成本（#367）

### 阶段 4

- [x] 用日用失败日志选定一个连接器或第二份交付模板（#369：日志没有指出缺连接器或第二份模板，本轮不加）
- [x] 用跨会话任务结果评估记忆是否有帮助（#370）
- [ ] 仍不做：通用工作流画布、多用户、大批连接器、只为缩小文件的重构
