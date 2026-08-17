import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import InboxPage from "./Inbox";
import { listInboxEmails } from "../api/client";

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
    selector({ addError: vi.fn() }),
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
    expect(screen.queryByText("暂无")).not.toBeInTheDocument();
    expect(listInboxEmails).toHaveBeenCalledWith(undefined, "all", 20);
  });

  it("keeps only the 20 most recent emails in the list", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
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
    expect(screen.getByText("主题 20")).toBeInTheDocument();
    expect(screen.queryByText("主题 21")).not.toBeInTheDocument();
  });
});
