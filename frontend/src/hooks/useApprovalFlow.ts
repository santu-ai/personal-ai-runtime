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

type ResolveResult = {
  result?: string;
  assistant_message?: string;
  pending?: boolean;
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
  const inflightApprovalsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    inflightApprovalsRef.current = new Set();
    setPendingConfirmation(null);
  }, [conversationId]);

  const confirm = useCallback(
    async (setMessages: SetMessages, onError?: (msg: string, source: string) => void) => {
      if (!pendingConfirmation) return;
      const pc = pendingConfirmation;
      setPendingConfirmation(null);

      try {
        const res = await resolveApproval(
          pc.approvalId,
          "approve",
          pc.toolCall.function_name,
          JSON.parse(pc.toolCall.arguments || "{}"),
          conversationId,
          pc.toolCall.id,
        );
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
        }
      } catch (err) {
        setPendingConfirmation(pc);
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "审批操作失败";
        onError?.(msg, "审批");
      }
    },
    [pendingConfirmation, conversationId],
  );

  const deny = useCallback(
    async (setMessages: SetMessages, onError?: (msg: string, source: string) => void) => {
      if (!pendingConfirmation) return;
      const pc = pendingConfirmation;
      setPendingConfirmation(null);

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
      } catch (err) {
        setPendingConfirmation(pc);
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "审批操作失败";
        onError?.(msg, "审批");
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

  return { pendingConfirmation, setPendingConfirmation, setFromEvent, confirm, deny };
}
