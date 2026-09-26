import { useState } from "react";
import Button from "../ui/Button";
import { TextArea } from "../ui/Input";
import RiskCard from "../approval/RiskCard";
import { useCapabilityPolicyQuery } from "../../hooks/useSettingsQuery";
import type { CapabilityPolicy } from "../../api/settings";
import { getRiskLevelFromPolicy } from "../../utils/riskMeta";
import { isImeKeyboardEvent } from "../../utils/imeKey";
import { toolLabel } from "../../utils/toolLabels";
import type { ToolCall } from "./types";

type ResolveAction = "confirm" | "deny";

interface Props {
  toolCall: ToolCall;
  onConfirm: (answer?: string) => void;
  onDeny: () => void;
  /** 这次续写还没回来时，点到的那一个。按钮和回答框都不禁用。 */
  busyAction?: ResolveAction | null;
}

const ANSWER_MAX = 8000;

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

interface SuggestionCopy {
  title: string;
  hint: string;
  confirm: string;
}

/** Proactive tools that are auto_allow but still framed as suggestions when confirmed. */
const EXTRA_SUGGESTION_TOOLS = new Set(["set_timer"]);

/** Prefer specific copy; fall back to toolLabel-based framing. */
const SUGGESTION_OVERRIDES: Record<string, SuggestionCopy> = {
  set_timer: {
    title: "建议：创建定时提醒",
    hint: "确认后将创建定时器，并继续执行当前对话。",
    confirm: "确认创建",
  },
  create_goal: {
    title: "建议：创建目标",
    hint: "确认后将创建目标，并继续执行当前对话。",
    confirm: "确认创建",
  },
  update_goal_progress: {
    title: "建议：更新目标进度",
    hint: "确认后将更新目标进度，并继续执行当前对话。",
    confirm: "确认更新",
  },
  complete_goal: {
    title: "建议：完成目标",
    hint: "确认后将标记目标完成，并继续执行当前对话。",
    confirm: "确认完成",
  },
  delete_goal: {
    title: "建议：删除目标",
    hint: "确认后将删除目标，并继续执行当前对话。",
    confirm: "确认删除",
  },
  send_email: {
    title: "建议：发送邮件",
    hint: "确认后将发送邮件，并继续执行当前对话。",
    confirm: "确认发送",
  },
  add_calendar_event: {
    title: "建议：添加日历日程",
    hint: "确认后将写入日历，并继续执行当前对话。",
    confirm: "确认添加",
  },
  write_file: {
    title: "建议：写入文件",
    hint: "确认后将写入文件，并继续执行当前对话。",
    confirm: "确认写入",
  },
  apply_patch: {
    title: "建议：修改文件",
    hint: "确认后将应用补丁，并继续执行当前对话。",
    confirm: "确认修改",
  },
  shell_exec: {
    title: "建议：执行命令",
    hint: "确认后将在本机执行命令，并继续执行当前对话。",
    confirm: "确认执行",
  },
  telegram_send: {
    title: "建议：发送 Telegram 消息",
    hint: "确认后将发送消息，并继续执行当前对话。",
    confirm: "确认发送",
  },
};

function isSuggestionTool(name: string, policy: CapabilityPolicy | null | undefined): boolean {
  if (EXTRA_SUGGESTION_TOOLS.has(name)) return true;
  return Boolean(policy?.needs_user?.includes(name));
}

function suggestionFor(
  name: string,
  policy: CapabilityPolicy | null | undefined,
): SuggestionCopy | undefined {
  if (!isSuggestionTool(name, policy)) return undefined;
  const override = SUGGESTION_OVERRIDES[name];
  if (override) return override;
  const label = toolLabel(name);
  return {
    title: `建议：${label}`,
    hint: "确认后将执行该操作，并继续执行当前对话。",
    confirm: "确认执行",
  };
}

export default function ConfirmationDialog({
  toolCall,
  onConfirm,
  onDeny,
  busyAction = null,
}: Props) {
  const { data: policy } = useCapabilityPolicyQuery();
  const isAskUser = toolCall.function_name === "ask_user";
  const riskLevel = isAskUser ? "low" : getRiskLevelFromPolicy(toolCall.function_name, policy);
  const suggestion = isAskUser ? undefined : suggestionFor(toolCall.function_name, policy);
  const args = parseToolArgs(toolCall.arguments);
  const question = typeof args.question === "string" ? args.question : "";
  const context = typeof args.context === "string" ? args.context : "";
  const [draft, setDraft] = useState("");
  const answer = draft.trim();
  const busy = busyAction !== null;

  const press = (run: () => void) => {
    if (busy) return;
    run();
  };

  return (
    <RiskCard
      action={toolCall.function_name}
      args={toolCall.arguments}
      riskLevel={riskLevel}
      policy={policy}
      variant="inline"
      title={isAskUser ? "需要你补充一点信息" : suggestion?.title}
    >
      <div className="w-full space-y-2">
        {isAskUser ? (
          <>
            <p className="text-sm text-fg-primary whitespace-pre-wrap">
              {question || "助手需要你的回答才能继续。"}
            </p>
            {context ? (
              <p className="text-xs text-fg-tertiary whitespace-pre-wrap">{context}</p>
            ) : null}
            <TextArea
              aria-label="你的回答"
              className="w-full"
              maxLength={ANSWER_MAX}
              value={draft}
              placeholder="输入回答，助手会带着它继续"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (busy) return;
                // 和快速捕获一样：组字或输入法处理键时的 Ctrl/Cmd+Enter 不把还没上屏的字发出去。
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || !answer) return;
                event.preventDefault();
                if (isImeKeyboardEvent(event.nativeEvent)) return;
                press(() => onConfirm(answer));
              }}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                data-confirm-action="confirm"
                disabled={!answer && busyAction !== "confirm"}
                aria-busy={busyAction === "confirm" || undefined}
                className={busyAction === "confirm" ? "opacity-50" : ""}
                onClick={() => press(() => onConfirm(answer))}
              >
                发送回答
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-confirm-action="deny"
                aria-busy={busyAction === "deny" || undefined}
                className={busyAction === "deny" ? "opacity-50" : ""}
                onClick={() => press(onDeny)}
              >
                取消
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-fg-tertiary">
              {suggestion?.hint ?? "确认后将执行工具并继续当前对话"}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                data-confirm-action="confirm"
                aria-busy={busyAction === "confirm" || undefined}
                className={busyAction === "confirm" ? "opacity-50" : ""}
                onClick={() => press(onConfirm)}
              >
                {suggestion?.confirm ?? "确认执行"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-confirm-action="deny"
                aria-busy={busyAction === "deny" || undefined}
                className={busyAction === "deny" ? "opacity-50" : ""}
                onClick={() => press(onDeny)}
              >
                取消
              </Button>
            </div>
          </>
        )}
      </div>
    </RiskCard>
  );
}
