import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import ChatHome from "./ChatHome";

const quickChat = vi.fn();
const setActiveConversation = vi.fn();

vi.mock("../../api/client", () => ({
  listMemoriesGrouped: vi.fn(),
  listInboxEmails: vi.fn(),
  countMemories: vi.fn().mockResolvedValue({ count: 0 }),
  ratifyMemory: vi.fn(),
  rejectMemory: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../api/workItems", () => ({
  listWorkItems: vi.fn(),
}));

vi.mock("../../stores/chatStore", () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      conversations: [
        {
          id: "conv-1",
          title: "上次对话",
          summary: "关于 Rust 的讨论",
          updated_at: "2026-06-28T10:00:00Z",
        },
      ],
      setActiveConversation,
    }),
}));

vi.mock("../../hooks/useQuickChat", () => ({
  useQuickChat: () => quickChat,
}));

vi.mock("../../hooks/useApprovalsQuery", () => ({
  useApprovalsQuery: () => ({ data: [] }),
}));

import { listMemoriesGrouped, listInboxEmails, countMemories } from "../../api/client";
import { listWorkItems } from "../../api/workItems";

const mockMemories = vi.mocked(listMemoriesGrouped);
const mockGoals = vi.mocked(listWorkItems);
const mockInbox = vi.mocked(listInboxEmails);
const mockCount = vi.mocked(countMemories);

describe("ChatHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(9);
    mockMemories.mockResolvedValue({ memories: [] });
    mockGoals.mockResolvedValue([]);
    mockInbox.mockResolvedValue([]);
    mockCount.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows morning greeting", async () => {
    renderWithRouter(<ChatHome />);
    expect(screen.getByText("早上好")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/今天没有待决断事项|这些事需要你决断/)).toBeInTheDocument();
    });
  });

  it("shows new-user nudge when no data", async () => {
    renderWithRouter(<ChatHome />);
    await waitFor(() => {
      expect(screen.getByText(/我还不太了解你/)).toBeInTheDocument();
    });
  });

  it("shows inbox nudge when emails present", async () => {
    mockInbox.mockResolvedValue([
      {
        id: "m1",
        subject: "Hello",
        sender: "a@b.com",
        preview: "Preview",
        received_at: "2026-06-28T10:00:00Z",
        category: "general",
        importance: 1,
        reason: "",
        notified: 0,
        digested: 0,
        status: "pending",
        created_at: "2026-06-28T10:00:00Z",
      },
    ]);
    renderWithRouter(<ChatHome />);
    await waitFor(() => {
      expect(screen.getByText(/收件箱有 1 封邮件/)).toBeInTheDocument();
    });
  });

  it("shows proposed memory banner on the home screen", async () => {
    mockCount.mockResolvedValue({ count: 2 });
    mockMemories.mockImplementation(async (opts = {}) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return { memories: [{ id: "m1", content: "喜欢早起跑步" }], total: 2 };
      }
      return { memories: [], total: 0 };
    });
    renderWithRouter(<ChatHome />);
    expect(await screen.findByText(/2 条记忆待确认后才会进入对话/)).toBeInTheDocument();
    expect(screen.getByText("喜欢早起跑步")).toBeInTheDocument();
    expect(screen.queryByText(/我已经记住了/)).not.toBeInTheDocument();
    expect(await screen.findByText(/这些事需要你决断或推进/)).toBeInTheDocument();
  });

  it("counts only ratified memories in the remember-you nudge", async () => {
    mockMemories.mockImplementation(async (opts = {}) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "ratified") {
        return { memories: [{ id: "m1", content: "喜欢绿茶" }], total: 1 };
      }
      return { memories: [], total: 0 };
    });
    renderWithRouter(<ChatHome />);
    expect(await screen.findByText(/我已经记住了 1 件关于你的事/)).toBeInTheDocument();
  });

  it("continues last conversation on click", async () => {
    renderWithRouter(<ChatHome />, { initialEntries: ["/"] });
    await waitFor(() => expect(screen.getByText("上次对话")).toBeInTheDocument());
    fireEvent.click(screen.getByText("上次对话"));
    expect(setActiveConversation).toHaveBeenCalledWith("conv-1");
  });

  it("sends from the home composer into a new chat", async () => {
    renderWithRouter(<ChatHome />);
    const input = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: "帮我规划今天" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(quickChat).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "帮我规划今天" }),
    );
  });

  it("handles proactive nudge click", async () => {
    renderWithRouter(<ChatHome />);
    await waitFor(() => expect(screen.getByText("开始对话")).toBeInTheDocument());
    fireEvent.click(screen.getByText("开始对话"));
    expect(quickChat).toHaveBeenCalledWith(expect.objectContaining({ title: "建立记忆" }));
  });
});
