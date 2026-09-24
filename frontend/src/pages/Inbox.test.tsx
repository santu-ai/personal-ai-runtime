import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import InboxPage from "./Inbox";
import {
  ApiError,
  getInboxEmailDetail,
  listInboxEmails,
  triggerInboxPoll,
  getInboxSyncStatus,
  type InboxEmail,
} from "../api/client";
import { getInboxEmailSummary } from "../api/inbox";
import { RECENT_INBOX_LIMIT } from "../hooks/useInboxQuery";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

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
});
