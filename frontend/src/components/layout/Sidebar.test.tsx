import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("shows data nav on chat route so destinations stay reachable", () => {
    renderSidebar();
    expect(screen.getByText("目标")).toBeInTheDocument();
    expect(screen.getByText("收件箱")).toBeInTheDocument();
    expect(screen.getByText("概览")).toBeInTheDocument();
  });

  it("shows data nav items on non-chat route", () => {
    renderSidebar("/goals");
    expect(screen.getAllByText("目标")[0]).toBeInTheDocument();
    expect(screen.getAllByText("任务")[0]).toBeInTheDocument();
    expect(screen.getAllByText("收件箱")[0]).toBeInTheDocument();
    expect(screen.getAllByText("记忆")[0]).toBeInTheDocument();
  });

  it("calls onSelectConversation when conversation clicked", () => {
    const onSelectConversation = vi.fn();
    renderSidebar("/", { onSelectConversation });
    fireEvent.click(screen.getByText("周末计划"));
    expect(onSelectConversation).toHaveBeenCalledWith("c2");
  });

  it("calls onNewChat when 新对话 clicked", () => {
    const onNewChat = vi.fn();
    renderSidebar("/", { onNewChat });
    fireEvent.click(screen.getByText("新对话"));
    expect(onNewChat).toHaveBeenCalled();
  });

  it("calls onDeleteChat when delete button clicked", () => {
    const onDeleteChat = vi.fn();
    renderSidebar("/", { onDeleteChat });
    const deleteButtons = screen.getAllByLabelText("删除对话");
    fireEvent.click(deleteButtons[0]);
    expect(onDeleteChat).toHaveBeenCalledWith("c1");
  });

  it("sends memories nav to the review tab when claims are pending", () => {
    proposedCountState.data = 2;
    renderSidebar();
    const memoryLink = screen.getByRole("link", { name: /记忆/ });
    expect(memoryLink).toHaveAttribute("href", "/memories?tab=review");
  });
});
