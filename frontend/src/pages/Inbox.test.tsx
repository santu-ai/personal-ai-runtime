import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import InboxPage from "./Inbox";
import { listInboxEmails, triggerInboxPoll } from "../api/client";
import { RECENT_INBOX_LIMIT } from "../hooks/useInboxQuery";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

vi.mock("../api/client", () => ({
  listInboxEmails: vi.fn().mockResolvedValue([]),
  getInboxDigest: vi.fn().mockResolvedValue({ title: "今日摘要", content: "无新邮件" }),
  triggerInboxPoll: vi.fn().mockResolvedValue({}),
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

  it("renders inbox title and poll button", async () => {
    renderWithRouter(<InboxPage />);
    expect(screen.getByText("收件箱")).toBeInTheDocument();
    expect(screen.getByText("立即轮询")).toBeInTheDocument();
    expect(await screen.findByText("今日摘要")).toBeInTheDocument();
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
    const unreadTitle = screen.getByLabelText("未读 请尽快回复 boss@corp.com")
      .querySelector("span");
    const readTitle = screen.getByLabelText("已读 促销活动 news@shop.com")
      .querySelector("span");
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
});
