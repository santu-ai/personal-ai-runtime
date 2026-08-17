/**
 * Inbox emails + digest. Poll/status mutations invalidate queryKeys.inbox.
 *
 * ``emails`` is the pending triage set (sidebar badge / 今日待办).
 * ``allEmails`` is the mailbox list (includes read / handled).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listInboxEmails, getInboxDigest, type InboxEmail } from "../api/client";
import { queryKeys } from "./useWsInvalidationBridge";

export interface InboxData {
  emails: InboxEmail[];
  allEmails: InboxEmail[];
  digest: { title?: string; content?: string; message?: string };
}

export function useInboxQuery(enabled = true) {
  return useQuery<InboxData>({
    queryKey: queryKeys.inbox,
    queryFn: async () => {
      const [allEmails, digest] = await Promise.all([
        listInboxEmails(undefined, "all"),
        getInboxDigest(),
      ]);
      const emails = allEmails.filter((e) => (e.status ?? "pending") === "pending");
      return { emails, allEmails, digest };
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useInvalidateInbox() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.inbox });
  };
}
