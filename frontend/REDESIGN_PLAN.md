# 前端重构 Plan：从「深色管理页面」到「安静可信的本地 Agent 控制台」

> v2 — 整合了 6 条修正：Tailwind v4 配置事实、Phase 1 拆分、`danger` 语义收窄、`RiskCard` 纯展示、后端确定性约束、新增 Phase 4 Chat 运行轨迹、Today 动态主卡。

## 设计哲学

**安静、可信的本地 Agent 控制台**——一个用户愿意每天托付任务的工作台。

核心原则：
- **石墨色为背景**：所有界面默认安静、退让，让信息和决策成为主角。
- **颜色 = 语义，不是装饰**：每种颜色只承担一种含义，绝不混用。
- **行动优先**：首页先回答"现在最该做什么"，运行指标降级为高级视图。
- **决策信息比技术参数更重要**：审批卡先解释"为什么/影响/可逆性"，再展示工具参数。
- **状态可见、轨迹紧凑**：Chat 里任务状态以紧凑轨迹呈现，原始日志默认折叠。

## 技术事实（不可绕过）

- **Tailwind v4 + Vite**，`@tailwindcss/vite` 插件，**没有 `tailwind.config.*`，也没有 `postcss.config.*`**。
- Token 必须通过 `tokens.css` + `@theme inline { ... }` + `@import` 落地，让 Tailwind 生成 `bg-surface-raised` 这种类。
- CSS 入口是 `src/index.css`，由 `main.tsx:7` 引入。token 文件在 `index.css` 顶部 `@import`。
- 现有 6 个 CSS 变量（`index.css:5-10`）**全站无人引用**，是装饰品——Phase 1a 会真正启用它们。

## 语义色板（唯一信源）

| 角色 | Token | 用途 | **严禁混用** |
|------|-------|------|--------------|
| **完成/安全** | `success` (绿) | 已完成、已通过、本地存储、健康检查通过 | 任何主操作按钮、通知边框、链接、品牌色 |
| **需要你决定** | `warning` (琥珀) | 待审批、即将过期、需要关注 | 普通强调、成功状态 |
| **不可逆风险** | `danger` (红) | **不可逆执行、删除、失败、错误**、真正的高风险影响 | ⚠️ **拒绝**（见下方修正 3） |
| **记忆与洞察** | `insight` (蓝紫) | 记忆、画像、AI 洞察、信息提示 | 审批、警告 |
| **背景/层级** | `surface.*` + `border.*` + `text.*` | 石墨色背景四档 + 边框两档 + 文字四档 | 带语义的状态 |

### 修正 3：`danger` 不包含"拒绝"

拒绝 Agent 的提议是**安全的、可逆的**用户决策——Agent 什么都没执行。所以：
- `拒绝` / `取消` / `稍后` → **克制的次级按钮**（`secondary` 或 `ghost` variant），与主按钮视觉权重分明但不抢戏。
- `danger` 只留给：删除对话/记忆、不可逆的工具执行（`shell_exec`、`send_email` 已发出）、失败/错误状态、真正会造成不可恢复影响的高风险操作。
- 这同时修正了 `Button.tsx:10` 当前 `danger` 的语义过宽问题（它现在被用于"删除"是对的，但要明确不能扩展到"拒绝"）。

---

## Phase 1a：Token 别名层（零视觉变化）

**目标**：建立 token → Tailwind 类的映射，让所有硬编码 `gray-*` / `emerald-*` 有可替换的目标。**此阶段视觉零变化**——只是给现有色值起别名。

**预计规模**：~120 行，1 个新文件 + 改 `index.css`。

### 交付物

1. **新建 `src/theme/tokens.css`**，用 Tailwind v4 的 `@theme inline`：

   ```css
   @import "tailwindcss";

   @theme inline {
     /* 背景/层级（沿用现有石墨色值，只是起别名） */
     --color-surface-base: #030712;     /* 原 gray-950 */
     --color-surface-raised: #111827;   /* 原 gray-900 */
     --color-surface-overlay: #1f2937;  /* 原 gray-800 */
     --color-surface-sunken: #030712;

     /* 边框 */
     --color-border-subtle: #1f2937;    /* 原 gray-800 */
     --color-border-strong: #374151;    /* 原 gray-700 */

     /* 文字 */
     --color-text-primary: #f3f4f6;     /* gray-100 */
     --color-text-secondary: #9ca3af;   /* gray-400 */
     --color-text-tertiary: #6b7280;    /* gray-500 */
     --color-text-disabled: #4b5563;    /* gray-600 */

     /* 语义色（值不变，只是统一入口） */
     --color-success: #10b981;
     --color-warning: #f59e0b;
     --color-danger: #ef4444;
     --color-insight: #6366f1;          /* indigo-500，记忆/洞察 */

     /* 焦点环（新） */
     --color-focus-ring: #6366f1;
   }
   ```

2. **改 `src/index.css`**：删除现有 6 个未使用的 `:root` 变量，改为 `@import "./theme/tokens.css"` 在最顶部。滚动条色从 `#374151` 改为 `var(--color-border-strong)`。

3. **焦点态基础设施**：在 `index.css` 加全局 `:focus-visible` 规则：

   ```css
   @layer base {
     :focus-visible {
       outline: 2px solid var(--color-focus-ring);
       outline-offset: 2px;
     }
   }
   ```

### 验收

- [ ] `npm run build` 通过，Tailwind 正确生成 `bg-surface-raised` 等类（在 build 产物里能搜到）
- [ ] **视觉零变化**（截图对比，无任何颜色差异）
- [ ] 现有 5 个 ui 组件和所有页面**未改动**
- [ ] 全局 `:focus-visible` 生效（Tab 导航可见焦点环）

---

## Phase 1b：语义组件层 + 经过评审的换色

**目标**：升级 5 个基础组件到语义层，**此处才做有视觉变化的换色**（主按钮从 emerald 改为中性强调）。每处换色都需截图评审。

**预计规模**：~250 行，5 个组件文件。

### 交付物

| 组件 | 改动 |
|------|------|
| `Button` | 新增 `loading` 态（spinner + disabled）、`focus-visible:ring-2 ring-focus-ring`；**`primary` 改为中性强调**（`bg-surface-overlay hover:bg-border-strong text-white`）；新增 `subtle`（ghost 弱化）variant；`danger` 语义收窄为"不可逆/删除" |
| `Card` | 新增 `variant: default \| interactive \| sunken`；interactive 自带 `hover:border-strong`；引用 `bg-surface-raised border-border-subtle` |
| `Badge` | 引用 token；新增 `insight` tone、`dot` 变体（小圆点 + 文字，用于状态指示） |
| `Input`/`Textarea`/`PasswordInput` | focus 从 `emerald-600` 改为 `border-focus-ring`；新增 `invalid` 态（`border-danger`） |
| `Dialog` | 引用 token；面板用 `bg-surface-raised border-border-strong` |

### 换色评审清单（每处单独截图 before/after）

1. Button primary 全站出现的位置（Sidebar "新对话"、Onboarding、Settings 保存等 ~8 处）
2. Input focus 态（Settings、Onboarding、QuickCapture）
3. Badge 在 Sidebar、Approvals、Dashboard 的呈现
4. Card 在所有列表页的呈现

**任何一处评审不通过就回滚该处，不影响其他**。

### 验收

- [ ] 主按钮不再是 emerald 绿（截图证据）
- [ ] `focus-visible` 在所有交互元素上可见
- [ ] Snapshot 测试 `vitest -u` 后通过，diff 已人工 review
- [ ] `rg "emerald-|green-"` 在 ui 组件目录 < 5 处（仅 Badge success）

---

## Phase 1c：硬编码替换（4 批次，渐进）

**目标**：把 646 处 `gray-*` 替换为 token 类。**纯机械替换，无视觉变化**（因为 Phase 1a 已经把 token 值设成与现有灰色一致）。

按风险从低到高，每批一个 PR：

| 批次 | 文件 | `gray-*` 数 | 风险 |
|------|------|------------|------|
| **C1** | Dashboard(85)、TrustReport(35)、Portrait(25)、Timeline(23) | 203 | 低，纯展示 |
| **C2** | Memories(33)、Goals(32)、Knowledge(30)、Inbox(13)、Approvals(17)、Settings(13) | 138 | 中，有交互 |
| **C3** | ChatView(36)、ToolCallDisplay(25)、MessageItem(12)、ConfirmationDialog(12) | 85 | 高，Chat 核心 |
| **C4** | Layout(11)、Sidebar(21)、NotificationBell(11)、toast、onboarding、settings 子组件、index.css markdown | ~120 | 中，全局壳 |

**emerald 收敛穿插在 C1-C4 中**：
- 通知 toast 边框 `border-emerald-700/50`（Layout.tsx:109）→ `border-border-subtle`（通知 ≠ 成功）
- Sidebar 标题 `text-emerald-400`（Sidebar.tsx:86）→ `text-text-primary`（品牌 ≠ 绿色）
- Sidebar 激活态 `bg-emerald-600/20 text-emerald-400` → `bg-surface-overlay text-text-primary`（导航激活 ≠ 成功）
- Dashboard "和 AI 对话"按钮 `bg-emerald-600/20` → 中性强调
- 保留 `success` 语义的：完成图标、健康检查通过、本地存储标识

### 验收

- [ ] `rg "gray-\d{2,3}"` 在 `src/**/*.tsx` < 50
- [ ] `rg "emerald-|green-"` < 30，且全部属于 success 语义
- [ ] 每批次 `vitest -u && vitest run && tsc && build` 通过
- [ ] 每批次结尾截图对比，视觉无明显变化（emerald 收敛点除外，那些是预期的）

---

## Phase 2：审批体验重构（信任感核心）

**目标**：Chat 弹窗和审批中心共用一套风险呈现与操作语言。把审批做成产品信任感的核心。

**预计规模**：~500 行，1 个新组件 + 改 2 个文件。

### 修正 4：`RiskCard` 是纯展示组件

**关键约束**：`RiskCard` **不能**包含任何 API 调用、状态管理、Chat 续写逻辑。它是纯函数式的展示组件，操作按钮通过 `children` 或 `actions` slot 注入。

```ts
interface RiskCardProps {
  action: string;
  args: Record<string, unknown>;
  source?: { conversationId?: string; flowLabel?: string; proposedBy?: string };
  timing?: { createdAt?: string; expiresAt?: string };
  // 纯展示，不传入 onClick
  children?: React.ReactNode;  // 操作按钮由父组件注入
  variant?: 'inline' | 'panel';  // Chat 内联 vs 审批中心
}
```

`RiskCard` 内部只做：
- 根据 `action` 查 `RISK_EXPLANATIONS` 和风险等级（沿用 `ConfirmationDialog.tsx:21-31` 已有逻辑，抽到 `utils/riskMeta.ts`）
- 渲染"为什么/影响/可逆性/有效期"四行决策信息
- 渲染 patch/write 预览（折叠）
- 渲染 `children`（按钮区）

**父组件负责**：
- `ConfirmationDialog`：注入 `[确认执行] [取消]` + trustSession 复选框 + 调用 `onConfirm(trustSession)`
- `ApprovalCard`：注入 `[批准并续写] [拒绝]` + 调用 approval API + 续写逻辑

这样 `RiskCard` 可可靠复用于：Chat 弹窗、审批中心、历史详情、单元测试。

### 修正 3 落地：按钮语义

```
[批准并续写 ▶]   ← 主按钮，中性强调色（不是 emerald，批准 ≠ 安全）
[拒绝]            ← secondary/ghost，克制（拒绝是安全可逆的，不是 danger）
```

仅当操作本身属于 `HIGH_RISK_OPS`（shell_exec、send_email 等）时，整个 RiskCard 容器用 `danger` 色调警示；但"拒绝"按钮本身仍然是克制的 secondary。

### 修正 5：后端确定性约束

`reversible`、`impact_summary`、`reason` **必须由后端 Capability/工具参数确定性生成**，不能由前端或 LLM 猜测。

- 前端 `RiskCard` 接受这些字段，但**为空时不编造**，而是显示 "—" 或 "未提供"。
- 前端不做任何"看起来像不可逆"的启发式判断。
- **"本次会话信任"** 必须有服务端的三重约束（前端只展示，不发裸 trust 标志）：
  - **能力范围**：`trust_scope: "write_file"` —— 只信任这一类工具
  - **资源范围**：`trust_resource: "/path/prefix/**"` —— 限定路径/收件人等
  - **到期时间**：`trust_expires_at: ISO` —— 到期自动失效
- 后端契约需要单独协商，纳入 backend API 文档。前端在契约就绪前，trustSession 复选框**禁用并标注"待后端支持"**，不阻塞其他工作。

### 信息层级（按钮在最下方）

```
┌─────────────────────────────────────────────┐
│  ⚠ 确认写入文件           [高风险] [即将过期]   │  标题 + Badge
├─────────────────────────────────────────────┤
│  为什么：写入文件是不可逆操作，文件内容会被覆盖。 │  风险解释
│  影响：  /src/app/config.ts （覆盖 2.1KB）     │  impact_summary（后端）
│  可撤销：否                                    │  reversible（后端）
│  有效期：23:59 前（仅审批中心）                 │  timing.expiresAt
├─────────────────────────────────────────────┤
│  ▾ 变更预览（diff 风格 +/-）                   │  技术细节，默认折叠
│  ▾ 详细参数（JSON）                            │
├─────────────────────────────────────────────┤
│  ☐ 本次会话内自动允许「写入文件」(待后端支持)    │  trust，禁用态
│                                              │
│  {children → [批准并续写 ▶]  [拒绝]}          │  按钮由父注入
└─────────────────────────────────────────────┘
```

### 交付物

1. **`src/utils/riskMeta.ts`**：从 `ConfirmationDialog` 抽出 `RISK_EXPLANATIONS`、`HIGH_RISK_OPS`、`describeToolAction` 的风险分级。
2. **`src/components/approval/RiskCard.tsx`**：纯展示组件 + slot。
3. **改造 `ConfirmationDialog`**：瘦身为 RiskCard + Chat 特有逻辑的薄壳。
4. **改造 `Approvals.tsx` 的 `ApprovalCard`**：替换为 RiskCard + 审批 API 调用。

### 验收

- [ ] Chat 弹窗和审批中心对同一类操作的呈现**完全一致**（只有 source/timing 字段不同）
- [ ] RiskCard 无任何 `useMutation` / `fetch` / store 调用（grep 验证）
- [ ] 决策信息在按钮上方
- [ ] 主按钮中性、拒绝按钮克制（非红）
- [ ] `reversible` / `impact_summary` 为空时显示 "—"，不编造
- [ ] trustSession 在后端契约就绪前为禁用态
- [ ] `ConfirmationDialog.test.tsx` + `Approvals.test.tsx` 更新并通过

---

## Phase 3：Today 首页（行动优先 + 动态主卡）

**目标**：把 Dashboard 改成回答"今天最该做什么"的 Today 页。运行指标移入折叠的高级视图。

**预计规模**：~400 行，主要在 `Dashboard.tsx`。

### 修正 6：三类卡片不始终等宽（动态主卡）

**存在待审批时**：审批卡占据**最强视觉权重**——左侧 2/3 宽度 + warning 色边 + 倒计时，进行中目标和邮件共享右侧 1/3。

**没有审批时**：进行中目标成为主卡，邮件为次卡。

**都没有时**：邮件或"今天没有需要处理的"空态。

布局规则：
```
有审批：  [ 待审批 · 2/3 宽 · warning ] [ 目标 · 1/3 ]
                                            [ 邮件 · 1/3 ]
无审批：  [ 进行中目标 · 1/2 ] [ 重要邮件 · 1/2 ]
都无：    [ 空态：今天暂无紧急事项 ]
```

这样"行动优先"才不会被均等布局稀释——最紧迫的事物理上占据最大空间。

### 信息架构重排

当前 `Dashboard.tsx`（487 行）自上而下：
1. 标题 + 刷新 + TabBar（概览/信任）
2. 待你决断（审批 + 邮件）—— ✅ 已有雏形，强化并改为主卡区
3. 我的数据（事件/记忆/目标/对话计数）—— ❌ 降级到折叠区
4. 快捷入口（对话/邮件/目标）—— ❌ 删除（与行动卡重复）
5. AI 记住了（记忆统计）—— ❌ 降级
6. AI 给你的提醒（通知）—— ✅ 保留提升
7. 系统诊断（已折叠）—— ✅ 扩展为"运行状况"

**新的 Today 页结构**：

```
┌─────────────────────────────────────────────┐
│  Today · 7月24日 周五              [信任 ▶]  │
├─────────────────────────────────────────────┤
│  ⚡ 今天最值得处理的                          │  动态主卡区（见上方规则）
│  [ 待审批 2 项 · 2/3 · warning ] [ 目标 ]    │
│  [ 即将过期 · 2h ]               [ 进度60% ] │
│  [ 去处理 ▶ ]                    [ 查看 ▶ ]  │
│                                    [ 邮件 3 ]│
├─────────────────────────────────────────────┤
│  💭 AI 给你的提醒                            │  保留提升
│  · 你昨天提到要联系 Charlie，还没做          │
│  · 目标"学习 Rust"已 5 天无进展             │
├─────────────────────────────────────────────┤
│  ▾ 运行状况（高级视图）                       │  原"系统诊断"扩展，默认折叠
│    Token / 成本 / 工具失败率 / 数据计数 ...  │
└─────────────────────────────────────────────┘
```

### 数据来源

- 待审批：`useApprovalsQuery`（已有），新增 `expires_at` 倒计时展示
- 进行中目标：`useGoalsQuery`（已有），需确认返回 `progress` / `last_activity_at`
- 重要邮件：`useInboxQuery`（已有），前端按"今天 + 未读"排序，或后端加 `priority` 字段（Phase 3 不强依赖）
- 提醒：`useNotifications`（已有）

**不新增任何 API**，仅前端重组。后端字段（`priority` 等）作为可选增强。

### 验收

- [ ] 首屏不滚动即可见"今天最值得处理的"行动区
- [ ] 存在审批时，审批卡视觉权重明显最强（宽度 + 颜色 + 倒计时）
- [ ] 无审批时，进行中目标自然成为主卡
- [ ] Token、事件数、成功率不在首屏（在折叠的高级视图）
- [ ] `Dashboard.test.tsx` 更新并通过

---

## Phase 4：Chat 运行轨迹（新增）

**目标**：在 Chat 内把"规划 → 等待审批 → 执行 → 结果"呈现为紧凑运行轨迹，链接对应 Work Item。这是把 Today 和审批体验真正连起来的一步。

**预计规模**：~350 行，1 个新组件 + 改 `ChatView` / `MessageItem`。

### 背景

当前 Chat 的工具调用展示（`ToolCallDisplay.tsx`）是**扁平的工具列表**：每个 tool_call 一个折叠卡，有"执行中 / ✓ 完成"两态。但 Agent 的真实运行是**有阶段轨迹**的：

```
用户：帮我把这封邮件整理成目标
│
├─ 📋 规划   AI 想要：读邮件 → 提炼 → 创建目标
├─ ⏸ 等待审批  create_goal（需要你确认）        ← 链接到审批
├─ ▶ 执行中  create_goal                        ← 可点击展开看参数
├─ ✅ 完成   已创建目标"Q3 规划"                ← 链接到 /goals/item
│
AI：我已经把邮件整理成目标"Q3 规划"...
```

### 交付物

1. **`src/components/chat/TaskTrack.tsx`**：紧凑的纵向轨迹组件
   - 每个阶段一个节点：图标 + 标签 + 状态色 + 时间
   - 状态：`planning` / `pending_approval` / `running` / `done` / `failed`
   - `pending_approval` 节点高亮 warning + 可点击跳转到审批卡（内联 RiskCard 或跳 `/approvals`）
   - `done` 节点可链接到对应 Work Item（目标、记忆、邮件等），用 `insight` 色点缀
   - **默认折叠原始工具参数和日志**，点击节点展开 `ToolCallDisplay` 的详情

2. **改 `ChatView` / `MessageItem`**：把连续的 tool_calls 归并为一根 TaskTrack，而不是多个独立 `ToolCallDisplay`。
   - 归并规则：同一 assistant 回合内的 tool_calls + 对应 tool_results
   - 如果只有 1 个 tool_call，退化回原 `ToolCallDisplay`（不强行套轨迹）

3. **Work Item 链接**：tool_result 里如果有 `work_item_id` / `work_item_type`（目标、记忆等），渲染为可点击链接，跳到对应详情页。

### 数据来源

- tool_calls + tool_results：`useChatMessages`（已有）
- 审批状态关联：通过 `correlation_id` 或 `tool_call_id` 与 `useApprovalsQuery` 交叉
- Work Item 链接：依赖 `listWorkItems`（`api/workItems.ts` 已有）返回的 id/type

### 验收

- [ ] 多步工具调用呈现为单根纵向轨迹，不再是一堆折叠卡
- [ ] `pending_approval` 阶段视觉醒目（warning），可跳到审批
- [ ] `done` 阶段如有 Work Item，可跳转
- [ ] 原始参数/日志默认折叠
- [ ] 单步工具调用不强行套轨迹（降级为原展示）
- [ ] `ChatView.test.tsx` + `ToolCallDisplay.test.tsx` 更新并通过

---

## 执行顺序与依赖

```
Phase 1a (Token 别名，零视觉变化)
   ↓
Phase 1b (语义组件 + 评审换色)
   ↓
   ├─ Phase 1c C1/C2（静态页替换，可并行）
   │     ↓
   │     Phase 2 (审批 RiskCard，依赖 Button/Badge/Card 语义层)
   │       ↓
   │       Phase 4 (Chat 轨迹，依赖 Phase 2 的 RiskCard)
   │
   └─ Phase 1c C3/C4（Chat/全局替换，与 Phase 2/4 协调）
         ↓
         Phase 3 (Today 首页，依赖全部组件语义层就绪)
```

**建议节奏**：
1. **Phase 1a + 1b** 必须先完成并 review——这是所有后续工作的地基。
2. **Phase 1c** 与 **Phase 2** 可并行（不同文件）。
3. **Phase 4** 依赖 Phase 2 的 `RiskCard`，建议在 Phase 2 之后。
4. **Phase 3** 建议最后做——它需要所有组件层稳定，且改动集中在单文件，风险可控。

## 不做的事（明确边界）

- **不重写任何业务逻辑、API 调用、状态管理**
- **不引入新的设计系统库**（不装 Radix、shadcn），保持 Tailwind v4 + 现有 5 组件的轻量路线
- **不新增基础组件超过 3 个**（RiskCard、TaskTrack，以及 Today 的 ActionCard 子件），避免组件爆炸
- **不动后端 API 契约**，除非 Phase 2/3/4 明确需要（`reversible` / `impact_summary` / `trust_scope` / `work_item_id`），且需单独与后端协商——前端在契约就绪前用禁用态或 "—" 兜底，不编造
- **不重命名路由**（`/dashboard` 保持，只是内容变成 Today）
- **不做完整移动端适配**，Phase 1c 顺便修复侧栏/告警的 `left-64` 硬编码（改为相对定位或 CSS 变量），完整响应式是后续独立工作

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Tailwind v4 `@theme inline` 配置错误导致类不生成 | Phase 1a 完成后立即在 build 产物里 `grep "surface-raised"` 验证 |
| Snapshot 大面积失败 | Phase 1c 每批次单独 `vitest -u`，PR 描述附 diff |
| 主按钮换色评审不通过 | Phase 1b 每处换色单独截图，可逐处回滚 |
| Token 命名后期想改 | Phase 1b 完成后锁定命名，后续改名走单独 PR |
| 后端契约不到位 | Phase 2 的 `reversible`/`trust_scope` 等用禁用态兜底，不阻塞前端 |
| Phase 4 归并规则误判 | 单步 tool_call 降级为原展示，保守不强行套轨迹 |
