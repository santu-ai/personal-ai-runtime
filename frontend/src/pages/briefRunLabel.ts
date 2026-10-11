import type { BriefProgress } from "../hooks/briefProgress";

const READ_TOOLS = new Set(["check_inbox", "read_file"]);
const FRESH_MS = 120_000;

function toolName(step: { tool?: unknown; name?: unknown; action?: unknown }): string {
  const tool = step.tool ?? step.name ?? step.action;
  return typeof tool === "string" ? tool : "";
}

/** Stage line while a project brief is running. Null once it stops. */
export function briefRunLabel(input: {
  status: string;
  isBrief: boolean;
  workId: string;
  steps: Array<{ tool?: unknown; name?: unknown; action?: unknown }>;
  resumeFrom: number;
  progress: BriefProgress | null;
  now?: number;
}): string | null {
  if (!input.isBrief || input.status !== "running") return null;
  const now = input.now ?? Date.now();
  const progress = input.progress;
  if (
    progress &&
    progress.workId === input.workId &&
    progress.stage &&
    now - progress.recordedAt < FRESH_MS
  ) {
    const read = Math.max(0, Math.floor(progress.sourcesRead));
    const total = Math.max(read, Math.floor(progress.sourcesTotal));
    if (total > 0) return `${progress.stage}（${read}/${total} 个来源）`;
    return progress.stage;
  }
  const tools = input.steps.map(toolName);
  const readIndexes = tools
    .map((tool, idx) => (READ_TOOLS.has(tool) ? idx : -1))
    .filter((idx) => idx >= 0);
  const done = readIndexes.filter((idx) => idx < input.resumeFrom).length;
  const current = tools[input.resumeFrom] ?? "";
  if (READ_TOOLS.has(current)) {
    const shownTotal = Math.max(readIndexes.length, 1);
    const shownRead = Math.min(done + 1, shownTotal);
    return `正在读取来源（${shownRead}/${shownTotal} 个来源）`;
  }
  return `正在写简报（已读取 ${done} 个来源）`;
}

/** Next step after a brief times out or the user cancels it. */
export function briefStopNotice(error: string, hasDelivery: boolean): string | null {
  const text = error.trim();
  if (text.startsWith("Timeout after")) {
    return hasDelivery
      ? "写简报超时。上一版交付还在，可以重新执行。"
      : "写简报超时。这一版还没有交出。可以重新执行。";
  }
  if (text === "cancelled") {
    return hasDelivery ? "已取消。上一版交付还在，可以再次运行。" : "已取消。可以重新执行。";
  }
  return null;
}
