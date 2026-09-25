import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "./Sidebar";

vi.mock("../../hooks/useApprovalsQuery", () => ({
  useApprovalsQuery: () => ({ data: [] }),
}));

vi.mock("../../hooks/useInboxQuery", () => ({
  useInboxQuery: () => ({ data: { emails: [], digest: {} } }),
}));

const proposedCountState = { data: 0 };

vi.mock("../../hooks/useMemoriesQuery", () => ({
  useProposedMemoryCountQuery: () => proposedCountState,
}));

function renderSidebar(initialEntry = "/", overrides = {}) {
  const defaultProps = {
    conversations: [
      { id: "c1", title: "Rust学习讨论" },
      { id: "c2", title: "周末计划" },
    ],
    activeConversationId: "c1",
    onSelectConversation: vi.fn(),
    onNewChat: vi.fn(),
    onDeleteChat: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Sidebar {...defaultProps} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposedCountState.data = 0;
  });

  it("renders app title", () => {
    renderSidebar();
    expect(screen.getByText("Personal AI")).toBeInTheDocument();
    expect(screen.getByText("本地第二大脑")).toBeInTheDocument();
  });

  it("shows chat as primary nav and settings on chat route", () => {
    renderSidebar();
    expect(screen.getAllByText("对话").length).toBeGreaterThan(0);
    expect(screen.getAllByText("设置")[0]).toBeInTheDocument();
  });

  it("shows conversation list on chat route", () => {
    renderSidebar();
    expect(screen.getByText("Rust学习讨论")).toBeInTheDocument();
    expect(screen.getByText("周末计划")).toBeInTheDocument();
  });

  it("shows grouped nav labels", () => {
    renderSidebar();
    expect(screen.getByText("概览", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("任务", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("知识")).toBeInTheDocument();
    expect(screen.getByText("系统")).toBeInTheDocument();
  });

  it("shows data nav on chat route so destinations stay reachable", () => {
    renderSidebar();
    expect(screen.getByText("目标")).toBeInTheDocument();
    expect(screen.getByText("收件箱")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "概览" })).toBeInTheDocument();
  });

  it("shows data nav items on non-chat route", () => {
    renderSidebar("/goals");
    expect(screen.getAllByText("目标")[0]).toBeInTheDocument();
    expect(screen.getAllByText("任务")[0]).toBeInTheDocument();
    expect(screen.getAllByText("收件箱")[0]).toBeInTheDocument();
    expect(screen.getAllByText("记忆")[0]).toBeInTheDocument();
  });

  it("links a conversation to its chat and selects it on a plain click", () => {
    const onSelectConversation = vi.fn();
    renderSidebar("/", { onSelectConversation });
    const current = screen.getByRole("link", { name: "Rust学习讨论" });
    const link = screen.getByRole("link", { name: "周末计划" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("href", "/chat/c2");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
    expect(link).not.toHaveAttribute("aria-current");
    fireEvent.click(link);
    expect(onSelectConversation).toHaveBeenCalledWith("c2");
  });

  it("keeps the current page when opening a conversation in a new tab", () => {
    const onSelectConversation = vi.fn();
    renderSidebar("/", { onSelectConversation });
    fireEvent.click(screen.getByRole("link", { name: "周末计划" }), { ctrlKey: true });
    expect(onSelectConversation).not.toHaveBeenCalled();
  });

  it("calls onNewChat when 新对话 clicked", () => {
    const onNewChat = vi.fn();
    renderSidebar("/", { onNewChat });
    fireEvent.click(screen.getByText("新对话"));
    expect(onNewChat).toHaveBeenCalled();
    expect(screen.queryByText("最近对话")).not.toBeInTheDocument();
  });

  it("keeps 新对话 enabled and busy while a chat is opening", () => {
    renderSidebar("/", { newChatBusy: true });
    const button = screen.getByRole("button", { name: "新对话" });
    button.focus();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("opacity-50");
    expect(button).toHaveFocus();
  });

  it("calls onDeleteChat when delete button clicked", () => {
    const onDeleteChat = vi.fn();
    renderSidebar("/", { onDeleteChat });
    const deleteButtons = screen.getAllByLabelText("删除对话");
    fireEvent.click(deleteButtons[0]);
    expect(onDeleteChat).toHaveBeenCalledWith("c1");
  });

  it("keeps an icon rail on a narrow viewport", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: String(query).includes("max-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      renderSidebar();
      expect(screen.queryByText("Personal AI")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "收起侧栏" })).not.toBeInTheDocument();
      const aside = document.querySelector("aside");
      expect(aside).toHaveAttribute("data-collapsed", "true");
      expect(aside).toHaveClass("w-[4.25rem]");
    } finally {
      window.matchMedia = original;
    }
  });

  it("sends memories nav to the review tab when claims are pending", () => {
    proposedCountState.data = 2;
    renderSidebar();
    const memoryLink = screen.getByRole("link", { name: /记忆/ });
    expect(memoryLink).toHaveAttribute("href", "/memories?tab=review");
  });

  it("shows the empty conversation copy only after a successful read", () => {
    renderSidebar("/", { conversations: [] });
    expect(screen.getByText("暂无对话")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-load-error")).not.toBeInTheDocument();
  });

  it("shows a loading line instead of an empty conversation list", () => {
    renderSidebar("/", { conversations: [], conversationsLoadPending: true });
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
  });

  it("shows the conversation read failure instead of an empty list", async () => {
    const onRetryConversations = vi.fn();
    renderSidebar("/", {
      conversations: [],
      conversationsLoadError: "会话暂时读不到",
      onRetryConversations,
    });
    const alert = screen.getByTestId("conversations-load-error");
    expect(alert).toHaveTextContent("会话暂时读不到");
    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
    fireEvent.click(retry);
    expect(onRetryConversations).toHaveBeenCalledOnce();
  });

  it("keeps the conversation retry visible while the reread is busy", () => {
    renderSidebar("/", {
      conversations: [],
      conversationsLoadError: "会话暂时读不到",
      conversationsLoadBusy: true,
    });
    expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
  });

  it("keeps listed conversations when a later read fails", () => {
    renderSidebar("/", { conversationsLoadError: "会话暂时读不到" });
    expect(screen.getByText("Rust学习讨论")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
  });
});
