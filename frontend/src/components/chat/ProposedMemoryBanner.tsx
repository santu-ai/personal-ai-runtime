import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, ratifyMemory, rejectMemory } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useMemoriesGroupedQuery, useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";

const PREVIEW_LIMIT = 3;

type BannerAction = "ratify" | "reject";

interface Handoff {
  id: string;
  action: BannerAction;
  /** 成功后要落到的那一条；失败时仍是刚才这一条。没有可落的按钮则为 null。 */
  targetId: string | null;
}

function groupedOpts(conversationId?: string) {
  return {
    claimStatus: "proposed" as const,
    limit: PREVIEW_LIMIT,
    order: "created_at_desc" as const,
    conversationId,
  };
}

/** 焦点在页面空白处，或还停在这次点的按钮上，才可以把焦点挪走。 */
function focusIsIdle(id: string, action: BannerAction): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  return (
    active instanceof HTMLButtonElement &&
    active.getAttribute("data-proposed-id") === id &&
    active.getAttribute("data-proposed-action") === action
  );
}

function focusAction(id: string, action: BannerAction): boolean {
  for (const node of document.querySelectorAll<HTMLButtonElement>("button[data-proposed-action]")) {
    if (node.getAttribute("data-proposed-id") !== id) continue;
    if (node.getAttribute("data-proposed-action") !== action) continue;
    if (node.disabled) continue;
    node.focus();
    return document.activeElement === node;
  }
  return false;
}

function focusReviewLink(): boolean {
  const link = document.querySelector<HTMLAnchorElement>("[data-proposed-review]");
  if (!link) return false;
  link.focus();
  return document.activeElement === link;
}

function focusComposer(): boolean {
  for (const input of document.querySelectorAll<HTMLTextAreaElement>("[data-chat-composer]")) {
    if (input.disabled) continue;
    input.focus();
    return document.activeElement === input;
  }
  return false;
}

interface Props {
  className?: string;
  /** When set, only show proposed memories extracted from this conversation. */
  conversationId?: string;
}

/**
 * Inline ratify/reject for proposed claims.
 *
 * Proposed memories are excluded from chat retrieval until ratified.
 * ChatHome previously had no path at all; ChatView only linked out to
 * /memories. Reuses existing memory APIs — no new fragment.
 */
export default function ProposedMemoryBanner({ className = "", conversationId }: Props) {
  const opts = groupedOpts(conversationId);
  const scope = conversationId ? { conversationId } : undefined;
  const { data: proposedCount = 0 } = useProposedMemoryCountQuery(scope);
  const { data } = useMemoriesGroupedQuery(opts);
  const queryClient = useQueryClient();
  const addError = useErrorStore((s) => s.addError);
  const busyRef = useRef(new Map<string, BannerAction>());
  const [busy, setBusy] = useState<Map<string, BannerAction>>(() => new Map());
  const focusAfter = useRef<Handoff | null>(null);
  const items = (data?.memories ?? []).slice(0, PREVIEW_LIMIT);
  const itemKey = items.map((row) => row.id).join("\0");

  const publishBusy = () => {
    setBusy(new Map(busyRef.current));
  };

  const freshIds = (): string[] | null => {
    const cached = queryClient.getQueryData<{ memories?: { id: string }[] }>([
      ...queryKeys.memoriesGrouped,
      opts,
    ]);
    if (!cached) return null;
    return (cached.memories ?? []).slice(0, PREVIEW_LIMIT).map((row) => row.id);
  };

  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || busy.has(pending.id)) return;
    if (!focusIsIdle(pending.id, pending.action)) {
      focusAfter.current = null;
      return;
    }
    if (pending.targetId && focusAction(pending.targetId, pending.action)) {
      focusAfter.current = null;
      return;
    }
    if (pending.targetId && proposedCount > 0) return;
    if (focusReviewLink() || focusComposer()) focusAfter.current = null;
  }, [busy, itemKey, proposedCount]);

  if (proposedCount <= 0) return null;

  const heading = conversationId
    ? `${proposedCount} 条本对话记忆待确认后才会进入对话`
    : `${proposedCount} 条记忆待确认后才会进入对话`;

  const act = async (id: string, action: BannerAction) => {
    if (busyRef.current.has(id)) return;
    busyRef.current.set(id, action);
    publishBusy();
    const order = items.map((row) => row.id);
    focusAfter.current = { id, action, targetId: id };
    let failed = false;
    try {
      if (action === "ratify") await ratifyMemory(id);
      else await rejectMemory(id);
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.memories }),
          queryClient.invalidateQueries({ queryKey: queryKeys.memoriesGrouped }),
        ]);
      } catch {
        // 写已经成功。列表没刷新时这一条还在，焦点留在按钮上。
      }
    } catch (err) {
      failed = true;
      addError(
        err instanceof ApiError
          ? err.message
          : action === "ratify"
            ? "确认记忆失败"
            : "拒绝记忆失败",
        "记忆",
      );
    } finally {
      if (!failed) {
        const fresh = freshIds();
        if (!fresh || fresh.includes(id)) {
          focusAfter.current = { id, action, targetId: id };
        } else {
          const index = order.indexOf(id);
          const next = order.slice(index + 1).find((rowId) => fresh.includes(rowId)) ?? null;
          const prev =
            order
              .slice(0, index)
              .reverse()
              .find((rowId) => fresh.includes(rowId)) ?? null;
          const incoming = fresh.find((rowId) => !order.includes(rowId)) ?? null;
          focusAfter.current = { id, action, targetId: next ?? prev ?? incoming };
        }
      }
      busyRef.current.delete(id);
      publishBusy();
    }
  };

  return (
    <div
      className={`px-4 py-2 bg-insight/10 border-b border-insight/30 text-xs text-insight ${className}`.trim()}
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0">{heading}</p>
        <Link
          to="/memories?tab=review"
          data-proposed-review=""
          className="shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          查看全部
        </Link>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((m) => {
            const action = busy.get(m.id);
            return (
              <li key={m.id} className="flex items-center gap-2 text-fg-primary">
                <span className="flex-1 min-w-0 truncate" title={m.content}>
                  {m.content}
                  {typeof m.confidence === "number" && (
                    <span className="text-fg-tertiary"> · {Math.round(m.confidence * 100)}%</span>
                  )}
                </span>
                <button
                  type="button"
                  data-proposed-id={m.id}
                  data-proposed-action="ratify"
                  aria-busy={action === "ratify" || undefined}
                  onClick={() => void act(m.id, "ratify")}
                  className={`shrink-0 px-2 py-0.5 rounded bg-insight/20 hover:bg-insight/30 text-insight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                    action === "ratify" ? " opacity-50" : ""
                  }`}
                >
                  确认
                </button>
                <button
                  type="button"
                  data-proposed-id={m.id}
                  data-proposed-action="reject"
                  aria-busy={action === "reject" || undefined}
                  onClick={() => void act(m.id, "reject")}
                  className={`shrink-0 px-2 py-0.5 rounded hover:bg-surface-overlay text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                    action === "reject" ? " opacity-50" : ""
                  }`}
                >
                  拒绝
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
