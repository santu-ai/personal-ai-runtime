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

function applyResolveToMessages(
  setMessages: SetMessages,
  assistantMsgId: string,
  toolName: string,
  toolCallId: string,
  res: { result?: string; assistant_message?: string },
  options?: { denied?: boolean },
) {
  setMessages((prev) => {
    const updated = prev.map((m) => {
      if (m.id !== assistantMsgId) return m;
      const existing = m.toolResults || [];
      const content = options?.denied
        ? JSON.stringify({ status: "denied", reason: "User denied the operation" })
        : res.result;
      return {
        ...m,
        isStreaming: false,
        toolResults: content
          ? [...existing, { tool_name: toolName, tool_call_id: toolCallId, content }]
          : existing,
      };
    });
    if (res.assistant_message) {
      updated.push({
        id: `assistant-followup-${Date.now()}`,
        role: "assistant",
        content: stripToolMarkup(res.assistant_message),
        isStreaming: false,
      });
    } else if (options?.denied) {
      updated.push({
        id: `assistant-followup-${Date.now()}`,
        role: "assistant",
        content: toolName ? `已拒绝「${toolName}」，没有执行该操作。` : "已拒绝该操作。",
        isStreaming: false,
      });
    }
    return updated;
  });
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
        applyResolveToMessages(
          setMessages,
          pc.assistantMsgId,
          pc.toolCall.function_name,
          pc.toolCall.id,
          res,
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
