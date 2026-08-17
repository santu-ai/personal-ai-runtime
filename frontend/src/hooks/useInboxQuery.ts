/**
 * Inbox emails + digest. Poll/status mutations invalidate queryKeys.inbox.
 *
 * ``emails`` is the pending triage set (sidebar badge / 今日待办).
 * ``allEmails`` is the recent mailbox list (includes read / handled), capped.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listInboxEmails, getInboxDigest, type InboxEmail } from "../api/client";
import { queryKeys } from "./useWsInvalidationBridge";

/** How many recent mails the inbox list keeps on screen. */
export const RECENT_INBOX_LIMIT = 15;

export interface InboxData {
  emails: InboxEmail[];
  allEmails: InboxEmail[];
  digest: { title?: string; content?: string; message?: string };
}

export function useInboxQuery(enabled = true) {
  return useQuery<InboxData>({
    queryKey: queryKeys.inbox,
    queryFn: async () => {
      const [pending, recent, digest] = await Promise.all([
        listInboxEmails(undefined, "pending"),
        listInboxEmails(undefined, "all", RECENT_INBOX_LIMIT),
        getInboxDigest(),
      ]);
      return {
        emails: pending,
        allEmails: recent.slice(0, RECENT_INBOX_LIMIT),
        digest,
      };
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
