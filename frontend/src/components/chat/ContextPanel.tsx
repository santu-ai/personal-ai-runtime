import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  searchMemories,
  listPendingApprovals,
  type MemoryRow,
  type Approval,
  type WorkItem,
} from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useErrorStore } from "../../stores/errorStore";
import LoadErrorNotice, { queryErrorMessage } from "../ui/LoadErrorNotice";
import type { ToolResult } from "./types";

interface Props {
  lastUserMessage?: string;
  toolResults?: ToolResult[];
  open: boolean;
  onToggle: () => void;
}

export default function ContextPanel({ lastUserMessage, toolResults = [], open, onToggle }: Props) {
  const addError = useErrorStore((s) => s.addError);
  const [goals, setGoals] = useState<WorkItem[]>([]);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const loadSeq = useRef(0);

  const loadContext = useCallback(async () => {
    const seq = ++loadSeq.current;
    setGoalsLoading(true);
    try {
      const allGoals = await listWorkItems("goal");
      if (seq !== loadSeq.current) return;
      const active = allGoals
        .filter((g) => g.status === "active")
        .sort((a, b) => {
          const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
          const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
          return tb - ta;
        })
        .slice(0, 3);
      setGoals(active);
      setGoalsError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      const message = queryErrorMessage(err, "加载目标失败");
      setGoalsError(message);
      addError(message, "上下文");
    } finally {
      if (seq === loadSeq.current) {
        setGoalsLoading(false);
        setGoalsLoaded(true);
      }
    }

    if (seq !== loadSeq.current) return;

    if (lastUserMessage && lastUserMessage.length > 5) {
      try {
        const q = lastUserMessage.slice(0, 50);
        const results = await searchMemories(q, 3);
        if (seq !== loadSeq.current) return;
        setMemories(results);
      } catch {
        // optional
      }
    }

    try {
      const pending = await listPendingApprovals();
      if (seq !== loadSeq.current) return;
      setApprovals(pending);
    } catch {
      // optional
    }
  }, [addError, lastUserMessage]);

  useEffect(() => {
    if (!open) return;
    void loadContext();
    return () => {
      loadSeq.current += 1;
    };
  }, [open, loadContext]);

  const recentTools = toolResults.slice(-3).reverse();

  if (!open) return null;

  return (
    <aside className="w-72 border-l border-border-subtle bg-surface-raised/50 overflow-y-auto shrink-0 flex flex-col">
      <div className="p-3 border-b border-border-subtle flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-primary">上下文</h3>
        <button
          type="button"
          data-confirm-exit=""
          onClick={onToggle}
          className="text-xs text-fg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          收起
        </button>
      </div>

      <div className="p-3 space-y-4 flex-1">
        {approvals.length > 0 && (
          <section>
            <h4 className="text-xs text-warning mb-2">待审批 ({approvals.length})</h4>
            {approvals.map((a) => (
              <div
                key={a.id}
                className="text-xs text-fg-secondary p-2 bg-warning/10 rounded-lg mb-1"
              >
                {a.action || "未知操作"}
              </div>
            ))}
          </section>
        )}

        <section>
          <h4 className="text-xs text-fg-tertiary mb-2">活跃目标</h4>
          {goals.length === 0 && goalsError ? (
            <LoadErrorNotice
              message={goalsError}
              busy={goalsLoading}
              onRetry={() => void loadContext()}
              testId="context-goals-load-error"
            />
          ) : goals.length === 0 && (!goalsLoaded || goalsLoading) ? (
            <p className="text-xs text-fg-disabled">加载中…</p>
          ) : goals.length === 0 ? (
            <p className="text-xs text-fg-disabled">暂无活跃目标</p>
          ) : (
            goals.map((g) => (
              <Link
                key={g.id}
                to={`/goals/${g.id}`}
                className="block w-full text-left text-xs text-fg-primary p-2 hover:bg-surface-overlay rounded-lg mb-1 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {g.title}
              </Link>
            ))
          )}
        </section>

        {memories.length > 0 && (
          <section>
            <h4 className="text-xs text-fg-tertiary mb-2">相关记忆</h4>
            {memories.map((m) => (
              <div
                key={m.id}
                className="text-xs text-fg-secondary p-2 bg-surface-overlay/50 rounded-lg mb-1 line-clamp-2"
              >
                {m.content}
              </div>
            ))}
          </section>
        )}

        {recentTools.length > 0 && (
          <section>
            <h4 className="text-xs text-fg-tertiary mb-2">最近工具</h4>
            {recentTools.map((t, i) => (
              <div
                key={`${t.tool_call_id}-${i}`}
                className="text-xs text-fg-secondary p-2 bg-surface-overlay/50 rounded-lg mb-1 truncate"
              >
                {t.tool_name}
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
