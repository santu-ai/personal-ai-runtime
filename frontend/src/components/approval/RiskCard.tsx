/**
 * RiskCard —— 审批风险展示的纯展示组件。
 *
 * 约束（Plan 修正 4）：
 * - 不包含任何 API 调用、状态管理、Chat 续写逻辑。
 * - 操作按钮通过 `children` slot 注入。
 * - 可复用于：Chat 弹窗、审批中心、历史详情、测试。
 *
 * 信息层级（按钮在最下方）：
 *   标题 + Badge → 为什么 → 影响 → 可撤销 → 有效期
 *   → Patch/Write 预览（如有）→ ▾ 详细参数
 *   → trustSession 复选框（中风险）
 *   → {children} 操作按钮
 */

import { type ReactNode } from "react";
import { toolLabel, describeToolAction } from "../../utils/toolLabels";
import { getRiskLevel, getRiskTone, RISK_EXPLANATIONS, type RiskLevel } from "../../utils/riskMeta";
import Badge from "../ui/Badge";

// ── 工具函数（从 ConfirmationDialog 抽取）──

const PREVIEW_LIMIT = 400;

function parseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

function truncate(text: string, max = PREVIEW_LIMIT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function ExpandableText({ text, className }: { text: string; className: string }) {
  const preview = truncate(text);
  const isTruncated = text.length > PREVIEW_LIMIT;

  return (
    <div className={className}>
      <div className="whitespace-pre-wrap break-all">{preview}</div>
      {isTruncated && (
        <details className="mt-1">
          <summary className="cursor-pointer text-fg-tertiary hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded">
            查看完整内容
          </summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-fg-secondary">
            {text}
          </pre>
        </details>
      )}
    </div>
  );
}

function PatchPreview({ args }: { args: Record<string, unknown> }) {
  const oldString = typeof args.old_string === "string" ? args.old_string : "";
  const newString = typeof args.new_string === "string" ? args.new_string : "";
  if (!oldString && !newString) return null;

  return (
    <div className="mb-3 rounded border border-warning/40 bg-surface-sunken/80 p-2 text-xs font-mono">
      <div className="mb-1 text-warning">变更预览</div>
      {oldString && <ExpandableText text={`− ${oldString}`} className="text-danger/90" />}
      {newString && <ExpandableText text={`+ ${newString}`} className="text-success/90" />}
      {args.replace_all === true && <div className="mt-1 text-fg-tertiary">replace_all = true</div>}
    </div>
  );
}

function WriteFilePreview({ args }: { args: Record<string, unknown> }) {
  const content = typeof args.content === "string" ? args.content : "";
  if (!content) return null;

  return (
    <div className="mb-3 rounded border border-warning/40 bg-surface-sunken/80 p-2 text-xs font-mono">
      <div className="mb-1 text-warning">写入内容预览</div>
      <ExpandableText text={content} className="text-warning/90" />
    </div>
  );
}

// ── RiskCard Props ──

export interface RiskCardProps {
  /** 工具函数名（如 "write_file"） */
  action: string;
  /** 工具参数 JSON 字符串 */
  args: string;
  /** 风险等级（如未传，由 action 自动判定） */
  riskLevel?: RiskLevel;
  /** 来源信息 */
  source?: {
    conversationId?: string;
    flowLabel?: string;
    proposedBy?: string;
  };
  /** 时间信息 */
  timing?: {
    createdAt?: string;
    expiresAt?: string;
  };
  /** 后端提供的确定性字段 —— 为空时显示 "—" */
  reversible?: boolean | null;
  impactSummary?: string | null;
  /** 展示变体：inline（Chat 内联）vs panel（审批中心卡片） */
  variant?: "inline" | "panel";
  /** 是否为即将过期（外部计算，驱动 Badge 显示） */
  expiringSoon?: boolean;
  /** 操作按钮由父组件注入 */
  children?: ReactNode;
  /** trustSession 复选框区域（由父组件管理状态） */
  trustSlot?: ReactNode;
}

export default function RiskCard({
  action,
  args: argsJson,
  riskLevel: explicitLevel,
  source,
  timing,
  reversible,
  impactSummary,
  variant = "inline",
  expiringSoon,
  children,
  trustSlot,
}: RiskCardProps) {
  const label = toolLabel(action);
  const parsedArgs = parseArgs(argsJson);
  const description = describeToolAction(action, parsedArgs);
  const riskLevel = explicitLevel ?? getRiskLevel(action);
  const tone = getRiskTone(riskLevel);
  const riskExplanation = RISK_EXPLANATIONS[action];
  const isPatch = action === "apply_patch";
  const isWrite = action === "write_file";

  // ── 失效期格式化 ──
  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  };

  const formatTimeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  return (
    <div className={`${tone.container} rounded-lg ${variant === "panel" ? "p-5" : "p-4"}`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`${tone.icon} text-xl mt-0.5 shrink-0`}>{tone.iconEmoji}</div>

        <div className="flex-1 min-w-0 space-y-2">
          {/* ── 标题行 —— */}
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`${tone.title} font-medium`}>确认{label}</h4>
            {riskLevel === "high" && <Badge tone="danger">高风险</Badge>}
            {expiringSoon && <Badge tone="danger">⏱ 即将过期</Badge>}
            {source?.flowLabel && <Badge tone="insight">{source.flowLabel}</Badge>}
          </div>

          {/* ── 为什么（风险解释）—— */}
          {riskExplanation && <p className={`text-xs ${tone.desc} italic`}>{riskExplanation}</p>}

          {/* ── 影响（后端确定性字段）—— */}
          {variant === "panel" && (
            <div className="text-xs space-y-1">
              <div>
                <span className="text-fg-tertiary">影响：</span>
                <span className="text-fg-secondary">{impactSummary || "—"}</span>
              </div>
              <div>
                <span className="text-fg-tertiary">可撤销：</span>
                <span className="text-fg-secondary">
                  {reversible === true ? "是" : reversible === false ? "否" : "—"}
                </span>
              </div>
            </div>
          )}

          {/* ── 操作描述 —— */}
          {description && (
            <p className={`${tone.desc} text-sm whitespace-pre-wrap`}>{description}</p>
          )}

          {/* ── Patch / Write 预览 —— */}
          {isPatch && <PatchPreview args={parsedArgs} />}
          {isWrite && <WriteFilePreview args={parsedArgs} />}

          {/* ── 详细参数（折叠）—— */}
          <details>
            <summary className="text-xs text-fg-tertiary cursor-pointer hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded">
              查看详细参数
            </summary>
            <pre className="bg-surface-sunken p-2 mt-1 rounded text-xs text-fg-secondary overflow-x-auto max-h-24 overflow-y-auto">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </details>

          {/* ── 时间 / 来源信息 —— */}
          <div className="flex items-center gap-4 text-xs text-fg-disabled flex-wrap">
            {timing?.createdAt && (
              <span title={formatTime(timing.createdAt)}>{formatTimeAgo(timing.createdAt)}</span>
            )}
            {timing?.expiresAt && (
              <span className={expiringSoon ? "text-danger" : ""}>
                过期：{formatTime(timing.expiresAt)}
              </span>
            )}
            {source?.proposedBy && <span>发起：{source.proposedBy}</span>}
          </div>

          {/* ── Trust session 插槽 —— */}
          {trustSlot}

          {/* ── 操作按钮（父组件注入）—— */}
          {children && <div className="flex gap-2 pt-1">{children}</div>}
        </div>
      </div>
    </div>
  );
}
