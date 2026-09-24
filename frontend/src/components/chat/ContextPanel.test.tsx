import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ContextPanel from "./ContextPanel";
import { searchMemories, listPendingApprovals } from "../../api/client";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

vi.mock("../../api/client", () => ({
  searchMemories: vi.fn(),
  listPendingApprovals: vi.fn(),
}));

vi.mock("../../api/workItems", () => ({
  listWorkItems: vi.fn(),
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: typeof addError }) => unknown) =>
    selector({ addError }),
}));

const mockGoals = [
  {
    id: "g1",
    title: "学习 Rust",
    status: "active",
    progress: 30,
    importance: 3,
    urgency: 2,
    parent_id: null,
    created_at: "2026-06-01T00:00:00Z",
    last_activity_at: "2026-06-10T10:00:00Z",
    description: null,
    deadline: null,
    actions: [],
    events: [],
  },
  {
    id: "g2",
    title: "健身计划",
    status: "active",
    progress: 50,
    importance: 2,
    urgency: 2,
    parent_id: null,
    created_at: "2026-06-01T00:00:00Z",
    last_activity_at: "2026-06-09T10:00:00Z",
    description: null,
    deadline: null,
    actions: [],
    events: [],
  },
  {
    id: "g3",
    title: "旧目标",
    status: "active",
    progress: 10,
    importance: 1,
    urgency: 1,
    parent_id: null,
    created_at: "2026-06-01T00:00:00Z",
    last_activity_at: "2026-06-01T10:00:00Z",
    description: null,
    deadline: null,
    actions: [],
    events: [],
  },
  {
    id: "g4",
    title: "已完成",
    status: "completed",
    progress: 100,
    importance: 1,
    urgency: 1,
    parent_id: null,
    created_at: "2026-06-01T00:00:00Z",
    last_activity_at: "2026-06-11T10:00:00Z",
    description: null,
    deadline: null,
    actions: [],
    events: [],
  },
];

import { listWorkItems } from "../../api/workItems";

describe("ContextPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWorkItems).mockResolvedValue(mockGoals as never);
    vi.mocked(searchMemories).mockResolvedValue([
      { id: "m1", content: "喜欢 Rust 所有权模型", category: "note", created_at: "" },
    ]);
    vi.mocked(listPendingApprovals).mockResolvedValue([
      { id: "a1", action: "write_file", status: "pending" },
    ]);
  });

  it("renders nothing when closed — ChatView owns the chrome toggle", () => {
    const { container } = render(
      <MemoryRouter>
        <ContextPanel open={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("loads and shows active goals sorted by last activity", async () => {
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    const rust = await screen.findByRole("link", { name: "学习 Rust" });
    expect(rust).toHaveAttribute("href", "/goals/g1");
    expect(rust).toHaveClass("focus-visible:ring-focus-ring");
    expect(screen.getByRole("link", { name: "健身计划" })).toHaveAttribute("href", "/goals/g2");
    expect(screen.getByText("健身计划")).toBeInTheDocument();
    expect(screen.getByText("旧目标")).toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  });

  it("shows pending approvals and related memories", async () => {
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} lastUserMessage="帮我解释 Rust 所有权" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/待审批/)).toBeInTheDocument();
    });
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText(/喜欢 Rust 所有权模型/)).toBeInTheDocument();
  });

  it("calls onToggle when collapse clicked", async () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={onToggle} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("收起"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows the empty goal copy only after a successful read", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("暂无活跃目标")).toBeInTheDocument();
    expect(screen.queryByTestId("context-goals-load-error")).not.toBeInTheDocument();
  });

  it("shows the goal read failure instead of an empty list", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new Error("目标暂时读不到"));
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    const alert = await screen.findByTestId("context-goals-load-error");
    expect(alert).toHaveTextContent("目标暂时读不到");
    expect(addError).toHaveBeenCalledWith("目标暂时读不到", "上下文");
    expect(screen.queryByText("暂无活跃目标")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the panel fallback when the goal error has no message", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new Error("   "));
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("context-goals-load-error")).toHaveTextContent("加载目标失败");
    expect(addError).toHaveBeenCalledWith("加载目标失败", "上下文");
    expect(screen.queryByText("暂无活跃目标")).not.toBeInTheDocument();
  });

  it("keeps the goal retry mounted until the reread finishes", async () => {
    let release: (() => void) | undefined;
    vi.mocked(listWorkItems).mockRejectedValueOnce(new Error("目标暂时读不到"));
    render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    vi.mocked(listWorkItems).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("context-goals-load-error")).toHaveTextContent("目标暂时读不到");
    expect(screen.queryByText("暂无活跃目标")).not.toBeInTheDocument();
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();

    release?.();
    expect(await screen.findByText("暂无活跃目标")).toBeInTheDocument();
    expect(screen.queryByTestId("context-goals-load-error")).not.toBeInTheDocument();
  });

  it("keeps listed goals when a later read fails", async () => {
    const view = render(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} lastUserMessage="短" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: "学习 Rust" })).toBeInTheDocument();

    vi.mocked(listWorkItems).mockRejectedValue(new Error("目标暂时读不到"));
    view.rerender(
      <MemoryRouter>
        <ContextPanel open={true} onToggle={vi.fn()} lastUserMessage="帮我再看一下目标" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "学习 Rust" })).toBeInTheDocument();
    await waitFor(() => expect(addError).toHaveBeenCalledWith("目标暂时读不到", "上下文"));
    expect(screen.queryByTestId("context-goals-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无活跃目标")).not.toBeInTheDocument();
  });
});
