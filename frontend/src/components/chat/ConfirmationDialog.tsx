import { useState } from "react";
import { toolLabel, describeToolAction } from "../../utils/toolLabels";
import Button from "../ui/Button";

interface ToolCall {
  index: number;
  id: string;
  function_name: string;
  arguments: string;
}

interface Props {
  toolCall: ToolCall;
  onConfirm: (trustSession?: boolean) => void;
  onDeny: () => void;
}

const PREVIEW_LIMIT = 400;

// 风险解释：告诉用户为什么这个操作需要确认
const RISK_EXPLANATIONS: Record<string, string> = {
  write_file: "写入文件是不可逆操作——文件内容会被覆盖。确认前请检查写入路径和内容。",
  apply_patch: "修改文件会改变现有内容。确认前请检查变更预览，尤其是删除的部分。",
  shell_exec: "执行命令可能影响系统状态，且无法撤销。请确认你信任这个命令。",
  send_email: "发送邮件后无法撤回。请确认收件人和内容正确。",
  add_calendar_event: "添加日历日程会写入你的日历。确认前请检查时间是否正确。",
  telegram_send: "发送 Telegram 消息后无法撤回。请确认内容和聊天对象。",
};

// 高风险操作（红色警示）
const HIGH_RISK_OPS = new Set(["shell_exec", "send_email", "telegram_send"]);

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

export default function ConfirmationDialog({ toolCall, onConfirm, onDeny }: Props) {
  const [trustSession, setTrustSession] = useState(false);
  const label = toolLabel(toolCall.function_name);
  const args = parseArgs(toolCall.arguments);
  const description = describeToolAction(toolCall.function_name, args);
  const isPatch = toolCall.function_name === "apply_patch";
  const isWrite = toolCall.function_name === "write_file";
  const isHighRisk = HIGH_RISK_OPS.has(toolCall.function_name);
  const riskExplanation = RISK_EXPLANATIONS[toolCall.function_name];

  // 高风险用红色，中风险用琥珀色
  const containerClass = isHighRisk
    ? "bg-danger/15 border border-danger/40"
    : "bg-warning/15 border border-warning/40";
  const iconClass = isHighRisk ? "text-danger" : "text-warning";
  const titleClass = isHighRisk ? "text-danger/90" : "text-warning/90";
  const descClass = isHighRisk ? "text-danger/70" : "text-warning/70";

  return (
    <div className={`${containerClass} rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <div className={`${iconClass} text-xl mt-0.5 shrink-0`}>{isHighRisk ? "🔒" : "⚠️"}</div>
        <div className="flex-1 min-w-0">
          <h4 className={`${titleClass} font-medium mb-1`}>确认{label}</h4>

          {/* 风险解释 —— 告诉用户为什么需要确认 */}
          {riskExplanation && (
            <p className={`text-xs ${descClass} mb-2 italic`}>{riskExplanation}</p>
          )}

          <p className="text-xs text-fg-tertiary mb-2">
            确认后将执行工具并自动续写一次回复；完整多步工具循环不会在服务重启后自动恢复，必要时请新开一轮对话。
          </p>

          {description && (
            <p className={`${descClass} text-sm mb-3 whitespace-pre-wrap`}>{description}</p>
          )}
          {isPatch && <PatchPreview args={args} />}
          {isWrite && <WriteFilePreview args={args} />}
          <details className="mb-3">
            <summary className="text-xs text-fg-tertiary cursor-pointer hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded">
              查看详细参数
            </summary>
            <pre className="bg-surface-sunken p-2 mt-1 rounded text-xs text-fg-secondary overflow-x-auto max-h-24 overflow-y-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          </details>

          {/* 信任选项 —— 中风险才显示（高风险每次都要确认） */}
          {!isHighRisk && (
            <label className="flex items-center gap-2 mb-3 text-xs text-fg-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={trustSession}
                onChange={(e) => setTrustSession(e.target.checked)}
                className="rounded"
              />
              本次对话内自动允许「{label}」
            </label>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={() => onConfirm(trustSession)}>
              确认执行
            </Button>
            <Button size="sm" variant="secondary" onClick={onDeny}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
