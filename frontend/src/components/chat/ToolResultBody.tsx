import type { KeyboardEvent, ReactNode } from "react";
import { isImeKeyboardEvent } from "../../utils/imeKey";

/** 纯文本结果超过这么多个字才截断。JSON 整段写出，不占这个上限。 */
const TOOL_RESULT_PREVIEW = 500;

const PANEL_PRE = "bg-surface-sunken p-2 rounded text-fg-primary overflow-x-auto";
const TRACK_PRE = "bg-surface-sunken p-1.5 rounded text-fg-primary overflow-x-auto text-[11px]";

function prettyJson(content: string): string | null {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return null;
  }
}

/** 空格和回车不把页面滚走。组字或输入法处理键时这一下不拦住。 */
function keepResultKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

function TruncatedResult({
  content,
  preClassName,
  boundClassName,
}: {
  content: string;
  preClassName: string;
  boundClassName: string;
}) {
  const preview = `${content.slice(0, TOOL_RESULT_PREVIEW)}\n... [truncated]`;
  return (
    <div
      tabIndex={0}
      data-tool-result-preview=""
      title={content}
      onKeyDown={keepResultKeysFromScrolling}
      className={`group rounded-sm focus-visible:max-h-none focus-visible:overflow-visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${boundClassName}`}
    >
      {/* 超过 500 个字时平时只写出前一段。键盘落到时写出整段。鼠标悬停仍是前一段。 */}
      <pre className={`${preClassName} group-focus-visible:hidden`}>{preview}</pre>
      <pre className={`${preClassName} hidden group-focus-visible:block`}>{content}</pre>
    </div>
  );
}

/**
 * 单步面板和多步轨迹共用的工具结果。
 * 纯文本超过 500 个字时，键盘落到这一段写出整段；短的和 JSON 不另占焦点。
 */
function boundedResult(
  frame: "panel" | "track",
  preClassName: string,
  boundClassName: string,
  text: string,
) {
  if (frame === "panel") {
    return (
      <div className={boundClassName}>
        <pre className={preClassName}>{text}</pre>
      </div>
    );
  }
  return <pre className={`${preClassName} ${boundClassName}`}>{text}</pre>;
}

export default function ToolResultBody({
  content,
  frame,
}: {
  content: string;
  frame: "panel" | "track";
}): ReactNode {
  const pretty = prettyJson(content);
  const preClassName = frame === "panel" ? PANEL_PRE : TRACK_PRE;
  const boundClassName =
    frame === "panel" ? "max-h-64 overflow-y-auto" : "max-h-24 overflow-y-auto";
  if (pretty !== null || content.length <= TOOL_RESULT_PREVIEW) {
    return boundedResult(frame, preClassName, boundClassName, pretty ?? content);
  }
  return (
    <TruncatedResult
      content={content}
      preClassName={preClassName}
      boundClassName={boundClassName}
    />
  );
}
