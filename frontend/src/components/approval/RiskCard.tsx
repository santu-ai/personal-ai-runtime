/**
 * RiskCard —— 审批风险展示的纯展示组件。
 *
 * 约束（Plan 修正 4）：
 * - 不包含任何 API 调用、状态管理、Chat 续写逻辑。
 * - 操作按钮通过 `children` slot 注入。
 * - 可复用于：Chat 弹窗、审批中心、历史详情、测试。
 *
 * 信息层级（按钮在最下方）：
 *   标题 + Badge → 为什么 → 影响/可撤销（仅后端字段就绪时）→ 有效期
 *   → Patch/Write 预览（如有）→ ▾ 详细参数
 *   → {children} 操作按钮
 */

import { type ReactNode } from "react";
import { toolLabel, describeToolAction } from "../../utils/toolLabels";
import {
  getRiskLevelFromPolicy,
  getRiskTone,
  RISK_EXPLANATIONS,
  type RiskLevel,
} from "../../utils/riskMeta";
import { formatTime, formatTimeAgo } from "../../utils/time";
import type { CapabilityPolicy } from "../../api/settings";
import Badge from "../ui/Badge";

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

export interface RiskCardProps {
  /** 工具函数名（如 "write_file"） */
  action: string;
  /** 工具参数 JSON 字符串 */
  args: string;
  /** 风险等级（如未传，由 policy / 默认判定） */
  riskLevel?: RiskLevel;
  /** 后端 CapabilityPolicy —— 用于风险分级 */
  policy?: CapabilityPolicy | null;
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
  /**
   * 后端确定性字段。仅当至少有一个字段非 undefined 时才渲染整块；
   * 契约未就绪时不要传，避免显示误导性的 "—"。
   */
  reversible?: boolean | null;
  impactSummary?: string | null;
  /** 展示变体：inline（Chat 内联）vs panel（审批中心卡片） */
  variant?: "inline" | "panel";
  /** 是否为即将过期（外部计算，驱动 Badge 显示） */
  expiringSoon?: boolean;
  /** 操作按钮由父组件注入 */
  children?: ReactNode;
}

export default function RiskCard({
  action,
  args: argsJson,
  riskLevel: explicitLevel,
  policy,
  source,
  timing,
  reversible,
  impactSummary,
  variant = "inline",
  expiringSoon,
  children,
}: RiskCardProps) {
  const label = toolLabel(action);
  const parsedArgs = parseArgs(argsJson);
  const description = describeToolAction(action, parsedArgs);
  const riskLevel = explicitLevel ?? getRiskLevelFromPolicy(action, policy);
  const tone = getRiskTone(riskLevel);
  const riskExplanation = RISK_EXPLANATIONS[action];
  const isPatch = action === "apply_patch";
  const isWrite = action === "write_file";
  const showBackendFields = reversible !== undefined || impactSummary !== undefined;

  return (
    <div className={`${tone.container} rounded-lg ${variant === "panel" ? "p-5" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <div className={`${tone.icon} text-xl mt-0.5 shrink-0`}>{tone.iconEmoji}</div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`${tone.title} font-medium`}>确认{label}</h4>
            {riskLevel === "high" && <Badge tone="danger">高风险</Badge>}
            {expiringSoon && <Badge tone="danger">⏱ 即将过期</Badge>}
            {source?.flowLabel && <Badge tone="insight">{source.flowLabel}</Badge>}
          </div>

          {riskExplanation && <p className={`text-xs ${tone.desc} italic`}>{riskExplanation}</p>}

          {variant === "panel" && showBackendFields && (
            <div className="text-xs space-y-1">
              {impactSummary !== undefined && (
                <div>
                  <span className="text-fg-tertiary">影响：</span>
                  <span className="text-fg-secondary">{impactSummary || "—"}</span>
                </div>
              )}
              {reversible !== undefined && (
                <div>
                  <span className="text-fg-tertiary">可撤销：</span>
                  <span className="text-fg-secondary">
                    {reversible === true ? "是" : reversible === false ? "否" : "—"}
                  </span>
                </div>
              )}
            </div>
          )}

          {description && (
            <p className={`${tone.desc} text-sm whitespace-pre-wrap`}>{description}</p>
          )}

          {isPatch && <PatchPreview args={parsedArgs} />}
          {isWrite && <WriteFilePreview args={parsedArgs} />}

          <details>
            <summary className="text-xs text-fg-tertiary cursor-pointer hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded">
              查看详细参数
            </summary>
            <pre className="bg-surface-sunken p-2 mt-1 rounded text-xs text-fg-secondary overflow-x-auto max-h-24 overflow-y-auto">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </details>

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

          {children && <div className="flex gap-2 pt-1">{children}</div>}
        </div>
      </div>
    </div>
  );
}
