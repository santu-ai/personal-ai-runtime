import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import ChatHome from "./ChatHome";
import { clearComposerDrafts } from "./composerDraft";

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

const approvalsState: {
  data?: { id: string }[];
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: [],
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

vi.mock("../../hooks/useApprovalsQuery", () => ({
  useApprovalsQuery: () => approvalsState,
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
    quickChat.mockReset();
    approvalsState.data = [];
    approvalsState.isPending = false;
    approvalsState.isFetching = false;
    approvalsState.isError = false;
    approvalsState.error = null;
    approvalsState.refetch = vi.fn();
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(9);
    mockMemories.mockResolvedValue({ memories: [] });
    mockGoals.mockResolvedValue([]);
    mockInbox.mockResolvedValue([]);
    mockCount.mockResolvedValue({ count: 0 });
    clearComposerDrafts();
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

  it("writes the full continue summary when the card is keyboard focused", async () => {
    renderWithRouter(<ChatHome />, { initialEntries: ["/"] });
    const link = await screen.findByRole("link", { name: /上次对话/ });
    const summary = screen.getByText("关于 Rust 的讨论");
    expect(summary).toHaveClass("line-clamp-1", "group-focus-visible:line-clamp-none");
    expect(summary.className).not.toContain("group-hover:");
    expect(link).toHaveClass("group");
    expect(summary.closest("a")).toBe(link);
  });

  it("continues last conversation from a link", async () => {
    renderWithRouter(<ChatHome />, { initialEntries: ["/"] });
    const link = await screen.findByRole("link", { name: /上次对话/ });
    expect(link).toHaveAttribute("href", "/chat/conv-1");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
    fireEvent.click(link);
    expect(setActiveConversation).toHaveBeenCalledWith("conv-1");
  });

  it("leaves the current page when the last conversation opens in a new tab", async () => {
    renderWithRouter(<ChatHome />, { initialEntries: ["/"] });
    const link = await screen.findByRole("link", { name: /上次对话/ });
    fireEvent.click(link, { ctrlKey: true });
    expect(setActiveConversation).not.toHaveBeenCalled();
  });

  it("links the approval nudge to the approvals page", async () => {
    approvalsState.data = [{ id: "ap-1" }];
    renderWithRouter(<ChatHome />);
    const link = await screen.findByRole("link", { name: "去审批" });
    expect(link).toHaveAttribute("href", "/approvals");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
  });

  it("sends from the home composer into a new chat", async () => {
    renderWithRouter(<ChatHome />);
    const input = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: "帮我规划今天" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(quickChat).toHaveBeenCalledWith(expect.objectContaining({ prompt: "帮我规划今天" }));
  });

  it("handles proactive nudge click", async () => {
    renderWithRouter(<ChatHome />);
    const start = await screen.findByRole("button", { name: "开始对话" });
    expect(start).toHaveClass("focus-visible:ring-focus-ring");
    fireEvent.click(start);
    expect(quickChat).toHaveBeenCalledWith(expect.objectContaining({ title: "建立记忆" }));
  });

  it("does not treat a failed insight read as an empty new user", async () => {
    let ratifiedCalls = 0;
    mockMemories.mockImplementation(async (opts = {}) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "ratified") {
        ratifiedCalls += 1;
        if (ratifiedCalls === 1) throw new Error("   ");
      }
      return { memories: [], total: 0 };
    });
    renderWithRouter(<ChatHome />);

    const error = await screen.findByTestId("chat-home-load-error");
    expect(error).toHaveTextContent("加载记忆失败");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();
    expect(screen.queryByText("今天没有待决断事项，开始新对话吧")).not.toBeInTheDocument();

    fireEvent.click(within(error).getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/我还不太了解你/)).toBeInTheDocument();
    expect(screen.getByText("今天没有待决断事项，开始新对话吧")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-home-load-error")).not.toBeInTheDocument();
  });

  it("keeps the home retry and the failure reason while the next read is in flight", async () => {
    let ratifiedCalls = 0;
    let release: ((value: { memories: [] }) => void) | undefined;
    mockMemories.mockImplementation(async (opts = {}) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status !== "ratified") return { memories: [], total: 0 };
      ratifiedCalls += 1;
      if (ratifiedCalls === 1) throw new Error("记忆暂时读不到");
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    renderWithRouter(<ChatHome />);

    const retry = await screen.findByRole("button", { name: "重试" });
    expect(screen.getByTestId("chat-home-load-error")).toHaveTextContent("记忆暂时读不到");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("chat-home-load-error")).toHaveTextContent("记忆暂时读不到");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();

    release?.({ memories: [] });
    expect(await screen.findByText(/我还不太了解你/)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-home-load-error")).not.toBeInTheDocument();
  });

  it("keeps a loaded goal nudge when another insight read fails", async () => {
    mockMemories.mockImplementation(async (opts = {}) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "ratified") throw new Error("记忆暂时读不到");
      return { memories: [], total: 0 };
    });
    mockGoals.mockResolvedValue([
      {
        id: "g1",
        title: "学习 Rust",
        description: null,
        work_type: "goal",
        parent_work_id: null,
        status: "active",
        priority: 0,
        dependencies_json: null,
        executable_plan: null,
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
        completed_at: null,
        progress: 0,
        importance: 1,
        urgency: 1,
        deadline: null,
        last_activity_at: "2020-01-01T00:00:00Z",
      },
    ]);
    renderWithRouter(<ChatHome />);

    expect(await screen.findByText(/学习 Rust/)).toBeInTheDocument();
    const error = screen.getByTestId("chat-home-load-error");
    expect(error).toHaveTextContent("记忆暂时读不到");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();
    expect(within(error).getByRole("button", { name: "重试" })).not.toHaveFocus();
  });

  it("does not treat a failed approval read as nothing to decide", async () => {
    approvalsState.data = undefined;
    approvalsState.isError = true;
    approvalsState.error = new Error("审批暂时读不到");
    renderWithRouter(<ChatHome />);

    const error = await screen.findByTestId("chat-home-load-error");
    expect(error).toHaveTextContent("审批暂时读不到");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();
    expect(screen.queryByText("今天没有待决断事项，开始新对话吧")).not.toBeInTheDocument();

    fireEvent.click(within(error).getByRole("button", { name: "重试" }));
    expect(approvalsState.refetch).toHaveBeenCalled();
  });

  it("does not treat a failed proposed-memory count as an empty home", async () => {
    mockCount.mockRejectedValueOnce(new Error("待确认暂时读不到"));
    renderWithRouter(<ChatHome />);

    const error = await screen.findByTestId("chat-home-load-error");
    expect(error).toHaveTextContent("待确认暂时读不到");
    expect(screen.queryByText(/我还不太了解你/)).not.toBeInTheDocument();

    mockCount.mockResolvedValue({ count: 0 });
    fireEvent.click(within(error).getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/我还不太了解你/)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-home-load-error")).not.toBeInTheDocument();
  });

  it("keeps the home draft until the new chat is created", async () => {
    const first = renderWithRouter(<ChatHome />);
    const box = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "首页这句" } });
    first.unmount();

    renderWithRouter(<ChatHome />);
    expect(await screen.findByPlaceholderText(/输入消息/)).toHaveValue("首页这句");

    let release: ((ok: boolean) => void) | undefined;
    quickChat.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(quickChat).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.(false);
    });
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue("首页这句");

    quickChat.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue(""));

    cleanup();
    renderWithRouter(<ChatHome />);
    expect(await screen.findByPlaceholderText(/输入消息/)).toHaveValue("");
  });

  it("keeps the composer usable while a home chat is being created", async () => {
    renderWithRouter(<ChatHome />);
    const box = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "首页这句" } });
    let release: ((ok: boolean) => void) | undefined;
    quickChat.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const send = screen.getByRole("button", { name: "发送" });
    const start = await screen.findByRole("button", { name: "开始对话" });
    send.focus();
    fireEvent.click(send);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(send).toBeEnabled();
    expect(box).toBeEnabled();
    expect(send).toHaveFocus();
    fireEvent.click(start);
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveAttribute("aria-busy");

    fireEvent.change(box, { target: { value: "改过的字" } });
    send.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      release?.(true);
    });
    expect(box).toHaveValue("改过的字");
    expect(send).not.toHaveAttribute("aria-busy");
    expect(document.activeElement).toBe(document.body);
    expect(box).not.toHaveFocus();
  });

  it("returns focus to the composer when a failed create leaves it blank", async () => {
    renderWithRouter(<ChatHome />);
    const box = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "首页这句" } });
    let release: ((ok: boolean) => void) | undefined;
    quickChat.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const send = screen.getByRole("button", { name: "发送" });
    send.focus();
    fireEvent.click(send);
    send.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      release?.(false);
    });
    expect(box).toHaveValue("首页这句");
    expect(box).toHaveFocus();
    expect(send).not.toHaveAttribute("aria-busy");
  });

  it("does not start another chat from a nudge while one is opening", async () => {
    renderWithRouter(<ChatHome />);
    const start = await screen.findByRole("button", { name: "开始对话" });
    const box = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "另一句" } });
    let release: ((ok: boolean) => void) | undefined;
    quickChat.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const send = screen.getByRole("button", { name: "发送" });
    start.focus();
    fireEvent.click(start);
    expect(start).toHaveAttribute("aria-busy", "true");
    expect(start).toBeEnabled();
    expect(start).toHaveFocus();
    fireEvent.click(start);
    fireEvent.click(send);
    expect(quickChat).toHaveBeenCalledTimes(1);
    expect(quickChat).toHaveBeenCalledWith(expect.objectContaining({ title: "建立记忆" }));
    expect(send).not.toHaveAttribute("aria-busy");

    screen.getByRole("link", { name: /上次对话/ }).focus();
    await act(async () => {
      release?.(false);
    });
    expect(start).not.toHaveFocus();
    expect(box).toHaveValue("另一句");

    start.focus();
    fireEvent.click(start);
    start.blur();
    await act(async () => {
      release?.(false);
    });
    expect(start).toHaveFocus();
    expect(quickChat).toHaveBeenCalledTimes(2);
  });

  it("returns the composer focus after a successful create only when it was left on send", async () => {
    renderWithRouter(<ChatHome />);
    const box = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "首页这句" } });
    let release: ((ok: boolean) => void) | undefined;
    quickChat.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const send = screen.getByRole("button", { name: "发送" });
    const link = screen.getByRole("link", { name: /上次对话/ });
    send.focus();
    fireEvent.click(send);
    link.focus();
    await act(async () => {
      release?.(true);
    });
    expect(box).toHaveValue("");
    expect(link).toHaveFocus();

    fireEvent.change(box, { target: { value: "再发一句" } });
    send.focus();
    fireEvent.click(send);
    await act(async () => {
      release?.(true);
    });
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });
});
