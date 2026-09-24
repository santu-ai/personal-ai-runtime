import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import InboxPage from "./Inbox";
import {
  ApiError,
  getInboxEmailDetail,
  listInboxEmails,
  triggerInboxPoll,
  getInboxSyncStatus,
  updateInboxEmailStatus,
  type InboxEmail,
} from "../api/client";
import { getInboxEmailSummary } from "../api/inbox";
import { RECENT_INBOX_LIMIT } from "../hooks/useInboxQuery";

const { addError, quickChat } = vi.hoisted(() => ({
  addError: vi.fn(),
  quickChat: vi.fn().mockResolvedValue(true),
}));

vi.mock("../api/client", () => ({
  listInboxEmails: vi.fn().mockResolvedValue([]),
  getInboxDigest: vi.fn().mockResolvedValue({ title: "今日摘要", content: "无新邮件" }),
  triggerInboxPoll: vi.fn().mockResolvedValue({}),
  getInboxSyncStatus: vi.fn().mockResolvedValue({
    status: "idle",
    error: null,
    error_kind: null,
    new_count: 0,
    synced_read: 0,
    duplicate_count: 0,
    classification_fallback: 0,
    uid_validity: null,
    next_uid: null,
    cursor_reset: false,
    synced_at: null,
    event_id: null,
    metrics: {
      days: 7,
      poll_count: 0,
      requested_count: 0,
      error_count: 0,
      errors_by_kind: {},
      new_count: 0,
      duplicate_count: 0,
      synced_read: 0,
      classification_fallback: 0,
      rapid_repeat_polls: 0,
    },
  }),
  updateInboxEmailStatus: vi.fn().mockResolvedValue({ id: "x", status: "read" }),
  getInboxEmailDetail: vi.fn(),
  createConversation: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../api/inbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/inbox")>();
  return {
    ...actual,
    getInboxEmailSummary: vi.fn().mockResolvedValue({
      email_id: "e1",
      subject: "请尽快回复",
      sender: "boss@corp.com",
      summary: "需要今天回复",
    }),
  };
});

vi.mock("../hooks/useQuickChat", () => ({
  useQuickChat: () => quickChat,
}));

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addError }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      addConversation: vi.fn(),
      setActiveConversation: vi.fn(),
      setPendingPrompt: vi.fn(),
    }),
}));

describe("InboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listInboxEmails).mockResolvedValue([]);
    vi.mocked(updateInboxEmailStatus).mockResolvedValue({ id: "x", status: "read" });
    quickChat.mockResolvedValue(true);
  });

  it("keeps recent emails visible and opens the digest in a dialog", async () => {
    renderWithRouter(<InboxPage />);
    expect(screen.getByText("收件箱")).toBeInTheDocument();
    expect(screen.getByText("立即轮询")).toBeInTheDocument();
    const openDigest = await screen.findByRole("button", { name: "查看摘要" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("无新邮件")).not.toBeInTheDocument();

    fireEvent.click(openDigest);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("今日摘要");
    expect(screen.getByText("无新邮件")).toBeInTheDocument();
  });

  it("lists synced emails below the digest", async () => {
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") => {
      if (status === "pending") return [];
      return [
        {
          id: "e1",
          sender: "billing@example.com",
          subject: "八月账单",
          preview: "您的账单已出",
          received_at: "2026-08-17T00:00:00Z",
          category: "important",
          importance: 0.9,
          reason: "账单",
          notified: 0,
          digested: 1,
          status: "read",
          created_at: "2026-08-17T00:00:00Z",
        },
      ];
    });
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText("八月账单")).toBeInTheDocument();
    expect(screen.getByText("最近邮件")).toBeInTheDocument();
    expect(screen.getByText("billing@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("无新邮件")).not.toBeInTheDocument();
    expect(screen.queryByText("您的账单已出")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无")).not.toBeInTheDocument();
    expect(listInboxEmails).toHaveBeenCalledWith(undefined, "all", RECENT_INBOX_LIMIT);
  });

  it("keeps only the most recent emails in the list", async () => {
    const rows = Array.from({ length: RECENT_INBOX_LIMIT + 1 }, (_, i) => ({
      id: `e${i}`,
      sender: "a@b.com",
      subject: `主题 ${i + 1}`,
      preview: "",
      received_at: `2026-08-17T00:00:${String(59 - i).padStart(2, "0")}Z`,
      category: "ignorable",
      importance: 0,
      reason: "",
      notified: 0,
      digested: 1,
      status: "read" as const,
      created_at: `2026-08-17T00:00:${String(59 - i).padStart(2, "0")}Z`,
    }));
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [] : rows,
    );
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText("主题 1")).toBeInTheDocument();
    expect(screen.getByText(`主题 ${RECENT_INBOX_LIMIT}`)).toBeInTheDocument();
    expect(screen.queryByText(`主题 ${RECENT_INBOX_LIMIT + 1}`)).not.toBeInTheDocument();
  });

  it("labels actionable unread as 需跟进 and styles unread stronger than read", async () => {
    const unread = {
      id: "u1",
      sender: "boss@corp.com",
      subject: "请尽快回复",
      preview: "这段预览不应出现",
      received_at: "2026-08-17T01:00:00Z",
      category: "actionable" as const,
      importance: 0.6,
      reason: "需要跟进",
      notified: 0,
      digested: 0,
      status: "pending" as const,
      created_at: "2026-08-17T01:00:00Z",
    };
    const read = {
      id: "r1",
      sender: "news@shop.com",
      subject: "促销活动",
      preview: "五折优惠也不应出现",
      received_at: "2026-08-17T00:00:00Z",
      category: "ignorable" as const,
      importance: 0.1,
      reason: "营销",
      notified: 0,
      digested: 1,
      status: "read" as const,
      created_at: "2026-08-17T00:00:00Z",
    };
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [unread] : [unread, read],
    );
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText(/需跟进/)).toBeInTheDocument();
    expect(screen.queryByText("这段预览不应出现")).not.toBeInTheDocument();
    expect(screen.queryByText("五折优惠也不应出现")).not.toBeInTheDocument();
    expect(screen.queryByText("需要跟进")).not.toBeInTheDocument();
    expect(screen.getByLabelText("未读 请尽快回复 boss@corp.com")).toBeInTheDocument();
    expect(screen.getByLabelText("已读 促销活动 news@shop.com")).toBeInTheDocument();
    const unreadTitle = screen
      .getByLabelText("未读 请尽快回复 boss@corp.com")
      .querySelector("span");
    const readTitle = screen.getByLabelText("已读 促销活动 news@shop.com").querySelector("span");
    expect(unreadTitle?.className).toContain("font-semibold");
    expect(readTitle?.className).toContain("font-normal");
  });

  it("surfaces a failed initial poll instead of swallowing it", async () => {
    vi.mocked(triggerInboxPoll).mockResolvedValue({
      status: "error",
      error: "invalid inbox JSON",
    });
    renderWithRouter(<InboxPage />);
    await waitFor(() => {
      expect(addError).toHaveBeenCalledWith("invalid inbox JSON", "收件箱");
    });
  });

  it("shows last sync failure kind and a retry action", async () => {
    vi.mocked(getInboxSyncStatus).mockResolvedValue({
      status: "error",
      error: "invalid inbox JSON",
      error_kind: "json",
      new_count: 0,
      synced_read: 0,
      duplicate_count: 0,
      classification_fallback: 0,
      uid_validity: null,
      next_uid: null,
      cursor_reset: false,
      synced_at: new Date().toISOString(),
      event_id: "evt_1",
      metrics: {
        days: 7,
        poll_count: 2,
        requested_count: 2,
        error_count: 1,
        errors_by_kind: { json: 1 },
        new_count: 0,
        duplicate_count: 3,
        synced_read: 1,
        classification_fallback: 0,
        rapid_repeat_polls: 1,
      },
    });
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText(/JSON 错误/)).toBeInTheDocument();
    expect(screen.getByText("invalid inbox JSON")).toBeInTheDocument();
    expect(screen.getByText("重试同步")).toBeInTheDocument();
    expect(screen.getByText(/快速重复 1/)).toBeInTheDocument();
    expect(screen.getByText(/重复邮件 3/)).toBeInTheDocument();
  });

  it("shows the empty mailbox after a successful read", async () => {
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText("还没有同步到邮件")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retry when the mailbox fails to load", async () => {
    vi.mocked(listInboxEmails).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<InboxPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "收件箱");
    expect(screen.queryByText("还没有同步到邮件")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the page fallback when the mailbox error has no message", async () => {
    vi.mocked(listInboxEmails).mockRejectedValue(new ApiError("   ", 500));
    renderWithRouter(<InboxPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("加载收件箱失败");
    expect(addError).toHaveBeenCalledWith("加载收件箱失败", "收件箱");
    expect(screen.queryByText("还没有同步到邮件")).not.toBeInTheDocument();
  });

  it("keeps the mailbox retry mounted until the reread finishes", async () => {
    vi.mocked(listInboxEmails).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<InboxPage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    let release: (() => void) | undefined;
    vi.mocked(listInboxEmails).mockImplementation(
      () =>
        new Promise((resolve) => {
          const prev = release;
          release = () => {
            prev?.();
            resolve([]);
          };
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("inbox-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(screen.queryByText("还没有同步到邮件")).not.toBeInTheDocument();

    release?.();
    expect(await screen.findByText("还没有同步到邮件")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-load-error")).not.toBeInTheDocument();
  });

  it("keeps loaded mail when a later read fails", async () => {
    vi.mocked(triggerInboxPoll).mockResolvedValue({});
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") => {
      if (status === "pending") return [];
      return [
        {
          id: "e1",
          sender: "billing@example.com",
          subject: "八月账单",
          preview: "",
          received_at: "2026-08-17T00:00:00Z",
          category: "important",
          importance: 0.9,
          reason: "",
          notified: 0,
          digested: 1,
          status: "read",
          created_at: "2026-08-17T00:00:00Z",
        },
      ];
    });
    renderWithRouter(<InboxPage />);
    expect(await screen.findByText("八月账单")).toBeInTheDocument();
    addError.mockClear();
    vi.mocked(listInboxEmails).mockRejectedValue(new ApiError("加载失败", 500));
    fireEvent.click(screen.getByRole("button", { name: "立即轮询" }));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("加载失败", "收件箱"));
    expect(screen.getByText("八月账单")).toBeInTheDocument();
    expect(screen.queryByText("还没有同步到邮件")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-load-error")).not.toBeInTheDocument();
  });

  function pendingMail(id: string, subject: string): InboxEmail {
    return {
      id,
      sender: "boss@corp.com",
      subject,
      preview: "预览不出现在列表",
      received_at: "2026-08-17T01:00:00Z",
      category: "important",
      importance: 0.8,
      reason: "需要回复",
      notified: 0,
      digested: 0,
      status: "pending",
      created_at: "2026-08-17T01:00:00Z",
    };
  }

  it("keeps the mail list and a retry when opening one message fails", async () => {
    const first = pendingMail("e1", "请尽快回复");
    const second = pendingMail("e2", "另一封账单");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [first, second] : [],
    );
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new ApiError("邮件暂时读不到", 503));
    renderWithRouter(<InboxPage />);

    const firstCard = (await screen.findByText("请尽快回复")).closest("div.rounded-lg");
    const secondCard = screen.getByText("另一封账单").closest("div.rounded-lg");
    expect(firstCard).toBeTruthy();
    expect(secondCard).toBeTruthy();
    fireEvent.click(within(firstCard as HTMLElement).getByRole("button", { name: "查看" }));

    const alert = await screen.findByTestId("inbox-detail-load-error");
    expect(alert).toHaveTextContent("邮件暂时读不到");
    expect(addError).toHaveBeenCalledWith("邮件暂时读不到", "收件箱");
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
    expect(screen.getByText("另一封账单")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(within(firstCard as HTMLElement).getByRole("button", { name: "查看" })).toBeEnabled();
    expect(
      within(secondCard as HTMLElement).getByRole("button", { name: "查看" }),
    ).not.toHaveAttribute("aria-busy");
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("holds the open-mail failure while that reread is in flight", async () => {
    const first = pendingMail("e1", "请尽快回复");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [first] : [],
    );
    vi.mocked(getInboxEmailDetail).mockRejectedValueOnce(new ApiError("邮件暂时读不到", 503));
    renderWithRouter(<InboxPage />);
    const card = (await screen.findByText("请尽快回复")).closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "查看" }));
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    let release: ((row: InboxEmail) => void) | undefined;
    vi.mocked(getInboxEmailDetail).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("inbox-detail-load-error")).toHaveTextContent("邮件暂时读不到");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "查看" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();

    release?.(first);
    expect(await screen.findByText("需要今天回复")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-detail-load-error")).not.toBeInTheDocument();
    expect(getInboxEmailSummary).toHaveBeenCalledWith("e1");
  });

  it("drops the previous mail's open failure when another mail is opened", async () => {
    const first = pendingMail("e1", "请尽快回复");
    const second = pendingMail("e2", "另一封账单");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [first, second] : [],
    );
    vi.mocked(getInboxEmailDetail).mockImplementation(async (id: string) => {
      if (id === "e1") throw new ApiError("邮件暂时读不到", 503);
      return new Promise<InboxEmail>(() => {});
    });
    renderWithRouter(<InboxPage />);
    const firstCard = (await screen.findByText("请尽快回复")).closest(
      "div.rounded-lg",
    ) as HTMLElement;
    const secondCard = screen.getByText("另一封账单").closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(firstCard).getByRole("button", { name: "查看" }));
    expect(await screen.findByTestId("inbox-detail-load-error")).toHaveTextContent(
      "邮件暂时读不到",
    );

    fireEvent.click(within(secondCard).getByRole("button", { name: "查看" }));
    await waitFor(() =>
      expect(within(secondCard).getByRole("button", { name: "查看" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    expect(screen.queryByText("邮件暂时读不到")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-detail-load-error")).not.toBeInTheDocument();
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
    expect(screen.getByText("另一封账单")).toBeInTheDocument();
  });

  it("opens a recent mail from the row and returns focus on Escape", async () => {
    const read: InboxEmail = {
      id: "e-read",
      sender: "billing@example.com",
      subject: "八月账单",
      preview: "预览不出现在列表",
      received_at: "2026-08-17T00:00:00Z",
      category: "important",
      importance: 0.9,
      reason: "账单",
      notified: 0,
      digested: 1,
      status: "read",
      created_at: "2026-08-17T00:00:00Z",
    };
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [] : [read],
    );
    let release: ((row: InboxEmail) => void) | undefined;
    vi.mocked(getInboxEmailDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<InboxPage />);

    const row = await screen.findByRole("button", { name: "已读 八月账单 billing@example.com" });
    expect(row).toHaveClass("focus-visible:ring-focus-ring");
    expect(screen.queryByRole("button", { name: "查看" })).not.toBeInTheDocument();
    row.focus();
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveAttribute("aria-busy", "true"));
    expect(getInboxEmailDetail).toHaveBeenCalledTimes(1);
    expect(getInboxEmailDetail).toHaveBeenCalledWith("e-read");
    expect(row).toHaveFocus();

    release?.(read);
    const dialog = await screen.findByRole("dialog", { name: "八月账单" });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  function triageCard(subject: string): HTMLElement {
    const card = screen.getByText(subject).closest("div.rounded-lg");
    if (!card) throw new Error(`missing triage card for ${subject}`);
    return card as HTMLElement;
  }

  it("does not mark the same mail twice and moves focus to the next card", async () => {
    let pending = [pendingMail("e1", "请尽快回复"), pendingMail("e2", "另一封账单")];
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? pending : [],
    );
    let release: () => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            pending = pending.filter((row) => row.id !== "e1");
            resolve({ id: "e1", status: "read" });
          };
        }),
    );
    renderWithRouter(<InboxPage />);
    const card = triageCard(
      await screen.findByText("请尽快回复").then((node) => node.textContent!),
    );
    const mark = within(card).getByRole("button", { name: "标记已读" });
    const ai = within(card).getByRole("button", { name: "让 AI 处理" });
    const view = within(card).getByRole("button", { name: "查看" });
    mark.focus();
    fireEvent.click(mark);
    fireEvent.click(mark);
    fireEvent.click(ai);
    await waitFor(() => expect(mark).toHaveAttribute("aria-busy", "true"));
    expect(mark).not.toBeDisabled();
    expect(mark).toHaveFocus();
    expect(ai).not.toHaveAttribute("aria-busy");
    expect(view).not.toHaveAttribute("aria-busy");
    expect(updateInboxEmailStatus).toHaveBeenCalledTimes(1);
    expect(updateInboxEmailStatus).toHaveBeenCalledWith("e1", "read");
    expect(quickChat).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    const nextCard = triageCard("另一封账单");
    const next = within(nextCard).getByRole("button", { name: "标记已读" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(screen.queryByText("请尽快回复")).not.toBeInTheDocument();
    expect(quickChat).not.toHaveBeenCalled();
  });

  it("moves focus to the recent row after the last unread card is marked read", async () => {
    const mail = pendingMail("e1", "请尽快回复");
    let pending: InboxEmail[] = [mail];
    let recent: InboxEmail[] = [];
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? pending : recent,
    );
    let release: () => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            pending = [];
            recent = [{ ...mail, status: "read" }];
            resolve({ id: "e1", status: "read" });
          };
        }),
    );
    renderWithRouter(<InboxPage />);
    const mark = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "标记已读" });
    mark.focus();
    fireEvent.click(mark);
    await act(async () => {
      release();
    });
    const row = await screen.findByRole("button", { name: "已读 请尽快回复 boss@corp.com" });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByRole("button", { name: "标记已读" })).not.toBeInTheDocument();
  });

  it("moves focus to 立即轮询 when a marked mail leaves and has no recent row", async () => {
    let pending = [pendingMail("e1", "请尽快回复")];
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? pending : [],
    );
    let release: () => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            pending = [];
            resolve({ id: "e1", status: "read" });
          };
        }),
    );
    renderWithRouter(<InboxPage />);
    const mark = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "标记已读" });
    mark.focus();
    fireEvent.click(mark);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "立即轮询" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "标记已读" })).not.toBeInTheDocument();
  });

  it("keeps focus on 标记已读 when the write fails", async () => {
    const mail = pendingMail("e1", "请尽快回复");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [mail] : [],
    );
    let fail: (err: unknown) => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithRouter(<InboxPage />);
    const mark = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "标记已读" });
    mark.focus();
    fireEvent.click(mark);
    fireEvent.click(mark);
    await waitFor(() => expect(mark).toHaveAttribute("aria-busy", "true"));
    expect(mark).not.toBeDisabled();
    expect(mark).toHaveFocus();
    expect(updateInboxEmailStatus).toHaveBeenCalledTimes(1);

    fail(new ApiError("标记已读失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("标记已读失败", "收件箱"));
    expect(mark).toHaveFocus();
    expect(mark).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
    expect(quickChat).not.toHaveBeenCalled();
  });

  it("does not pull focus back after 标记已读 when it already moved", async () => {
    let pending = [pendingMail("e1", "请尽快回复"), pendingMail("e2", "另一封账单")];
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? pending : [],
    );
    let release: () => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            pending = pending.filter((row) => row.id !== "e1");
            resolve({ id: "e1", status: "read" });
          };
        }),
    );
    renderWithRouter(<InboxPage />);
    const mark = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "标记已读" });
    const poll = screen.getByRole("button", { name: "立即轮询" });
    mark.focus();
    fireEvent.click(mark);
    poll.focus();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByText("请尽快回复")).not.toBeInTheDocument());
    expect(poll).toHaveFocus();
    expect(
      within(triageCard("另一封账单")).getByRole("button", { name: "标记已读" }),
    ).not.toHaveFocus();
  });

  it("does not open a second chat while 让 AI 处理 is in flight", async () => {
    const first = pendingMail("e1", "请尽快回复");
    const second = pendingMail("e2", "另一封账单");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [first, second] : [],
    );
    let releaseStatus: () => void = () => {};
    vi.mocked(updateInboxEmailStatus).mockImplementation((id: string, status: string) => {
      if (id !== "e1") return Promise.resolve({ id, status });
      return new Promise((resolve) => {
        releaseStatus = () => resolve({ id, status: "handled" });
      });
    });
    let releaseChat: (ok: boolean) => void = () => {};
    quickChat.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseChat = resolve;
        }),
    );
    renderWithRouter(<InboxPage />);
    const card = triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!));
    const ai = within(card).getByRole("button", { name: "让 AI 处理" });
    const mark = within(card).getByRole("button", { name: "标记已读" });
    ai.focus();
    fireEvent.click(ai);
    fireEvent.click(ai);
    fireEvent.click(mark);
    await waitFor(() => expect(ai).toHaveAttribute("aria-busy", "true"));
    expect(ai).not.toBeDisabled();
    expect(ai).toHaveFocus();
    expect(mark).not.toHaveAttribute("aria-busy");
    expect(updateInboxEmailStatus).toHaveBeenCalledTimes(1);
    expect(updateInboxEmailStatus).toHaveBeenCalledWith("e1", "handled");
    expect(quickChat).not.toHaveBeenCalled();

    const other = within(triageCard("另一封账单")).getByRole("button", { name: "标记已读" });
    fireEvent.click(other);
    await waitFor(() => expect(updateInboxEmailStatus).toHaveBeenCalledTimes(2));
    expect(updateInboxEmailStatus).toHaveBeenLastCalledWith("e2", "read");

    await act(async () => {
      releaseStatus();
    });
    await waitFor(() => expect(quickChat).toHaveBeenCalledTimes(1));
    expect(quickChat).toHaveBeenCalledWith({
      title: "邮件：请尽快回复",
      prompt:
        "请帮我处理这封邮件：\n发件人：boss@corp.com\n主题：请尽快回复\n预览：预览不出现在列表\n分类：important\n原因：需要回复",
    });
    fireEvent.click(ai);
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(ai).toHaveFocus();

    await act(async () => {
      releaseChat(true);
    });
    await waitFor(() => expect(ai).not.toHaveAttribute("aria-busy"));
    expect(ai).toHaveFocus();
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(updateInboxEmailStatus).toHaveBeenCalledTimes(2);
  });

  it("still opens one chat when marking handled fails, and keeps focus", async () => {
    const mail = pendingMail("e1", "请尽快回复");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [mail] : [],
    );
    vi.mocked(updateInboxEmailStatus).mockRejectedValue(new ApiError("标记处理失败", 500));
    let releaseChat: (ok: boolean) => void = () => {};
    quickChat.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseChat = resolve;
        }),
    );
    renderWithRouter(<InboxPage />);
    const ai = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "让 AI 处理" });
    ai.focus();
    fireEvent.click(ai);
    fireEvent.click(ai);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("标记处理失败", "收件箱"));
    await waitFor(() => expect(quickChat).toHaveBeenCalledTimes(1));
    expect(ai).toHaveAttribute("aria-busy", "true");
    expect(ai).toHaveFocus();
    fireEvent.click(ai);
    expect(updateInboxEmailStatus).toHaveBeenCalledTimes(1);
    expect(quickChat).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseChat(false);
    });
    await waitFor(() => expect(ai).not.toHaveAttribute("aria-busy"));
    expect(ai).toHaveFocus();
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
  });

  it("moves focus like 标记已读 when the chat cannot be opened", async () => {
    let pending = [pendingMail("e1", "请尽快回复"), pendingMail("e2", "另一封账单")];
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? pending : [],
    );
    vi.mocked(updateInboxEmailStatus).mockImplementation(async () => {
      pending = pending.filter((row) => row.id !== "e1");
      return { id: "e1", status: "handled" };
    });
    quickChat.mockResolvedValue(false);
    renderWithRouter(<InboxPage />);
    const ai = within(
      triageCard(await screen.findByText("请尽快回复").then((n) => n.textContent!)),
    ).getByRole("button", { name: "让 AI 处理" });
    ai.focus();
    fireEvent.click(ai);
    const next = within(
      await screen
        .findByText("另一封账单")
        .then((node) => node.closest("div.rounded-lg") as HTMLElement),
    ).getByRole("button", { name: "标记已读" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("请尽快回复")).not.toBeInTheDocument();
  });

  it("uses the page fallback when opening a message fails without a message", async () => {
    const first = pendingMail("e1", "请尽快回复");
    vi.mocked(listInboxEmails).mockImplementation(async (_category, status = "pending") =>
      status === "pending" ? [first] : [],
    );
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new Error("   "));
    renderWithRouter(<InboxPage />);
    const card = (await screen.findByText("请尽快回复")).closest("div.rounded-lg") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "查看" }));
    expect(await screen.findByTestId("inbox-detail-load-error")).toHaveTextContent(
      "加载邮件详情失败",
    );
    expect(addError).toHaveBeenCalledWith("加载邮件详情失败", "收件箱");
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  function holdPoll() {
    let release: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(triggerInboxPoll).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    return (value: Record<string, unknown> = {}) => release(value);
  }

  it("does not start another poll while the opening sync is in flight and keeps focus", async () => {
    const release = holdPoll();
    renderWithRouter(<InboxPage />);
    const poll = await screen.findByRole("button", { name: "轮询中..." });
    expect(poll).toBeEnabled();
    expect(poll).toHaveAttribute("aria-busy", "true");
    expect(triggerInboxPoll).toHaveBeenCalledTimes(1);
    poll.focus();
    fireEvent.click(poll);
    fireEvent.click(poll);
    expect(triggerInboxPoll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveFocus();

    await act(async () => {
      release();
    });
    const idle = await screen.findByRole("button", { name: "立即轮询" });
    expect(idle).not.toHaveAttribute("aria-busy");
    expect(idle).toHaveFocus();
    expect(triggerInboxPoll).toHaveBeenCalledTimes(1);
  });

  it("does not start a second poll from 重试同步 while one is in flight", async () => {
    vi.mocked(getInboxSyncStatus).mockResolvedValue({
      status: "error",
      error: "invalid inbox JSON",
      error_kind: "json",
      new_count: 0,
      synced_read: 0,
      duplicate_count: 0,
      classification_fallback: 0,
      uid_validity: null,
      next_uid: null,
      cursor_reset: false,
      synced_at: new Date().toISOString(),
      event_id: "evt_1",
      metrics: {
        days: 7,
        poll_count: 1,
        requested_count: 1,
        error_count: 1,
        errors_by_kind: { json: 1 },
        new_count: 0,
        duplicate_count: 0,
        synced_read: 0,
        classification_fallback: 0,
        rapid_repeat_polls: 0,
      },
    });
    const release = holdPoll();
    renderWithRouter(<InboxPage />);
    const retry = await screen.findByRole("button", { name: "重试中..." });
    const poll = screen.getByRole("button", { name: "轮询中..." });
    expect(retry).toBeEnabled();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(poll).toHaveAttribute("aria-busy", "true");
    expect(triggerInboxPoll).toHaveBeenCalledTimes(1);
    retry.focus();
    fireEvent.click(retry);
    fireEvent.click(poll);
    expect(triggerInboxPoll).toHaveBeenCalledTimes(1);
    expect(retry).toHaveFocus();

    await act(async () => {
      release();
    });
    expect(await screen.findByRole("button", { name: "重试同步" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "立即轮询" })).not.toHaveAttribute("aria-busy");
  });

  it("keeps focus on 立即轮询 when the poll fails", async () => {
    renderWithRouter(<InboxPage />);
    await waitFor(() => expect(triggerInboxPoll).toHaveBeenCalledTimes(1));
    const poll = await screen.findByRole("button", { name: "立即轮询" });
    await waitFor(() => expect(poll).not.toHaveAttribute("aria-busy"));

    let fail: (err: unknown) => void = () => {};
    vi.mocked(triggerInboxPoll).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    poll.focus();
    fireEvent.click(poll);
    const busy = await screen.findByRole("button", { name: "轮询中..." });
    expect(busy).toBeEnabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveFocus();
    fireEvent.click(busy);
    expect(triggerInboxPoll).toHaveBeenCalledTimes(2);

    await act(async () => {
      fail(new ApiError("邮箱暂时连不上", 503));
    });
    const again = await screen.findByRole("button", { name: "立即轮询" });
    expect(again).not.toHaveAttribute("aria-busy");
    expect(again).toHaveFocus();
    expect(addError).toHaveBeenCalledWith("邮箱暂时连不上", "收件箱");
  });

  it("does not pull focus back when it moved during the opening sync", async () => {
    const release = holdPoll();
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <InboxPage />
      </>,
    );
    await screen.findByRole("button", { name: "轮询中..." });
    const other = screen.getByRole("button", { name: "旁边" });
    other.focus();
    await act(async () => {
      release();
    });
    await screen.findByRole("button", { name: "立即轮询" });
    expect(other).toHaveFocus();
  });
});
