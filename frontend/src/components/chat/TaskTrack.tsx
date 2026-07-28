/**
 * TaskTrack —— Chat 内紧凑的任务轨迹组件。
 *
 * 在 Chat 内把"准备 → 执行 → 结果"呈现为紧凑纵向轨迹。
 * - 只在多步 tool_call 时由父组件挂载（单步用 ToolCallDisplay）
 * - done 节点 ✓ 完成（success 色点）
 * - failed 节点 ✗ 失败（danger）
 * - running 节点旋转 spinner（中性）
 * - 原始参数/日志默认折叠，点击节点展开
 */

import { useState } from "react";
import { toolLabel, toolIcon } from "../../utils/toolLabels";
import { detectOutcome } from "./detectToolFailure";
import { formatArgs } from "./formatArgs";
import type { ToolCall, ToolResult } from "./types";

interface TaskStage {
  toolCall: ToolCall;
  result?: ToolResult;
}

interface Props {
  stages: TaskStage[];
}

function formatResult(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content.length > 500 ? content.slice(0, 500) + "\n... [truncated]" : content;
  }
}

export default function TaskTrack({ stages }: Props) {
  const [expandedStageIdx, setExpandedStageIdx] = useState<number | null>(null);
  const doneCount = stages.filter((s) => s.result).length;

  return (
    <div className="mb-3 bg-surface-raised/40 rounded-lg border border-border-strong p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5 text-xs">
        <span className="text-fg-tertiary font-medium">任务轨迹</span>
        <span className="text-fg-disabled ml-auto">
          {doneCount}/{stages.length} 完成
        </span>
      </div>

      {/* Stages */}
      <div className="relative pl-4">
        {/* Vertical connector line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border-strong" aria-hidden />

        {stages.map((stage, idx) => {
          const status = detectOutcome(stage.result);
          const label = toolLabel(stage.toolCall.function_name);
          const icon = toolIcon(stage.toolCall.function_name);
          const isExpanded = expandedStageIdx === idx;

          const dotColor = {
            done: "bg-success",
            failed: "bg-danger",
            running: "bg-fg-tertiary",
          }[status];

          return (
            <div key={stage.toolCall.id || idx} className="relative pb-2.5 last:pb-0">
              {/* Dot */}
              <span
                aria-hidden
                className={`absolute left-[-11px] top-1.5 w-2.5 h-2.5 rounded-full ${dotColor} border-2 border-surface-base shrink-0`}
              />

              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedStageIdx(isExpanded ? null : idx)}
                className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs shrink-0">{icon}</span>
                  <span className="text-xs font-medium text-fg-primary truncate">{label}</span>

                  {/* Status badge */}
                  {status === "running" ? (
                    <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-fg-tertiary">
                      <svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      执行中
                    </span>
                  ) : status === "done" ? (
                    <span className="ml-auto shrink-0 text-[10px] text-success">✓ 完成</span>
                  ) : (
                    <span className="ml-auto shrink-0 text-[10px] text-danger">✗ 失败</span>
                  )}
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="ml-5 mt-2 space-y-2 text-xs" role="region">
                  <div>
                    <div className="text-fg-tertiary mb-0.5">参数</div>
                    <pre className="bg-surface-sunken p-1.5 rounded text-fg-primary overflow-x-auto text-[11px] max-h-24 overflow-y-auto">
                      {formatArgs(stage.toolCall.arguments)}
                    </pre>
                  </div>
                  {stage.result && (
                    <div>
                      <div className="text-fg-tertiary mb-0.5">结果</div>
                      <pre className="bg-surface-sunken p-1.5 rounded text-fg-primary overflow-x-auto text-[11px] max-h-24 overflow-y-auto">
                        {formatResult(stage.result.content)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
