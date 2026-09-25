import { useState, useCallback, useRef, useEffect } from "react";
import { resolveApproval, ApiError } from "../api/client";
import type { DisplayMessage } from "./useChatMessages";
import { stripToolMarkup } from "../utils/stripToolMarkup";

interface PendingConfirmation {
  toolCall: {
    index: number;
    id: string;
    function_name: string;
    arguments: string;
  };
  approvalId: string;
  assistantMsgId: string;
}

type SetMessages = React.Dispatch<React.SetStateAction<DisplayMessage[]>>;

type ResolveAction = "confirm" | "deny";

type ResolveResult = {
  status?: string;
  result?: string;
  assistant_message?: string;
  pending?: boolean;
  retryable?: boolean;
  error?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  approval_id?: string;
  tool_call_id?: string;
  tool_results?: Array<{ tool_name: string; tool_call_id: string; content: string }>;
};

function applyResolveToMessages(
  setMessages: SetMessages,
  assistantMsgId: string,
  toolName: string,
  toolCallId: string,
  res: ResolveResult,
  options?: { denied?: boolean },
): string | undefined {
  let followupId: string | undefined;
  setMessages((prev) => {
    const updated = prev.map((m) => {
      if (m.id !== assistantMsgId) return m;
      const existing = m.toolResults || [];
      const content = options?.denied
        ? JSON.stringify({ status: "denied", reason: "User denied the operation" })
        : res.result;
      const extra = (res.tool_results || []).filter((r) => r.tool_call_id !== toolCallId);
      return {
        ...m,
        isStreaming: false,
        toolResults: content
          ? [
              ...existing,
              { tool_name: toolName, tool_call_id: toolCallId, content },
              ...extra.map((r) => ({
                tool_name: r.tool_name,
                tool_call_id: r.tool_call_id,
                content: r.content,
              })),
            ]
          : existing,
      };
    });
    if (res.pending && res.approval_id) {
      followupId = `assistant-followup-${Date.now()}`;
      updated.push({
        id: followupId,
        role: "assistant",
        content: res.assistant_message ? stripToolMarkup(res.assistant_message) : "",
        isStreaming: false,
        toolCalls: [
          {
            index: 0,
            id: res.tool_call_id || "",
            function_name: res.tool_name || "",
            arguments: JSON.stringify(res.tool_args || {}),
          },
        ],
      });
    } else if (res.assistant_message) {
      followupId = `assistant-followup-${Date.now()}`;
      updated.push({
        id: followupId,
        role: "assistant",
        content: stripToolMarkup(res.assistant_message),
        isStreaming: false,
      });
    } else if (options?.denied) {
      followupId = `assistant-followup-${Date.now()}`;
      updated.push({
        id: followupId,
        role: "assistant",
        content: toolName ? `已拒绝「${toolName}」，没有执行该操作。` : "已拒绝该操作。",
        isStreaming: false,
      });
    }
    return updated;
  });
  return followupId;
}

export function useApprovalFlow(conversationId: string) {
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [resolvingAction, setResolvingAction] = useState<ResolveAction | null>(null);
  const inflightApprovalsRef = useRef<Set<string>>(new Set());
  const resolvingRef = useRef<ResolveAction | null>(null);

  useEffect(() => {
    inflightApprovalsRef.current = new Set();
    resolvingRef.current = null;
    setResolvingAction(null);
    setPendingConfirmation(null);
  }, [conversationId]);

  const beginResolve = (action: ResolveAction) => {
    if (resolvingRef.current) return false;
    resolvingRef.current = action;
    setResolvingAction(action);
    return true;
  };

  const endResolve = () => {
    resolvingRef.current = null;
    setResolvingAction(null);
  };

  const confirm = useCallback(
    async (
      setMessages: SetMessages,
      onError?: (msg: string, source: string) => void,
      answer?: string,
    ) => {
      if (!pendingConfirmation || !beginResolve("confirm")) return;
      const pc = pendingConfirmation;

      try {
        const toolArgs = JSON.parse(pc.toolCall.arguments || "{}") as Record<string, unknown>;
        const res = answer
          ? await resolveApproval(
              pc.approvalId,
              "approve",
              pc.toolCall.function_name,
              toolArgs,
              conversationId,
              pc.toolCall.id,
              answer,
            )
          : await resolveApproval(
              pc.approvalId,
              "approve",
              pc.toolCall.function_name,
              toolArgs,
              conversationId,
              pc.toolCall.id,
            );
        if (res.status === "resume_failed" || res.retryable) {
          onError?.(res.error || "续写失败，可再试一次", "审批");
          return;
        }
        const followupId = applyResolveToMessages(
          setMessages,
          pc.assistantMsgId,
          pc.toolCall.function_name,
          pc.toolCall.id,
          res,
        );
        if (res.pending && res.approval_id) {
          const nextId = res.approval_id;
          inflightApprovalsRef.current.add(nextId);
          setPendingConfirmation({
            toolCall: {
              index: 0,
              id: res.tool_call_id || "",
              function_name: res.tool_name || "",
              arguments: JSON.stringify(res.tool_args || {}),
            },
            approvalId: nextId,
            assistantMsgId: followupId || pc.assistantMsgId,
          });
        } else {
          setPendingConfirmation(null);
        }
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "审批操作失败";
        onError?.(msg, "审批");
      } finally {
        endResolve();
      }
    },
    [pendingConfirmation, conversationId],
  );

  const deny = useCallback(
    async (setMessages: SetMessages, onError?: (msg: string, source: string) => void) => {
      if (!pendingConfirmation || !beginResolve("deny")) return;
      const pc = pendingConfirmation;

      try {
        const res = await resolveApproval(
          pc.approvalId,
          "deny",
          pc.toolCall.function_name,
          JSON.parse(pc.toolCall.arguments || "{}"),
          conversationId,
          pc.toolCall.id,
        );
        applyResolveToMessages(
          setMessages,
          pc.assistantMsgId,
          pc.toolCall.function_name,
          pc.toolCall.id,
          res,
          { denied: true },
        );
        setPendingConfirmation(null);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "审批操作失败";
        onError?.(msg, "审批");
      } finally {
        endResolve();
      }
    },
    [pendingConfirmation, conversationId],
  );

  const setFromEvent = useCallback(
    (
      assistantMsgId: string,
      event: {
        tool_name?: string;
        approval_id?: string;
        tool_args?: Record<string, unknown>;
        tool_call_id?: string;
      },
      _setMessages?: SetMessages,
    ) => {
      const toolName = event.tool_name || "";
      const approvalId = event.approval_id || "";
      const toolCallId = event.tool_call_id || "";

      // Guard against duplicate confirmation_required events for the same approval.
      if (approvalId) {
        if (inflightApprovalsRef.current.has(approvalId)) return;
        inflightApprovalsRef.current.add(approvalId);
      }

      setPendingConfirmation({
        toolCall: {
          index: 0,
          id: toolCallId,
          function_name: toolName,
          arguments: JSON.stringify(event.tool_args || {}),
        },
        approvalId,
        assistantMsgId,
      });
    },
    [],
  );

  return {
    pendingConfirmation,
    resolvingAction,
    setPendingConfirmation,
    setFromEvent,
    confirm,
    deny,
  };
}
