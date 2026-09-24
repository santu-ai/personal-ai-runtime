import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import GoalsPage from "./Goals";
import { ApiError, getGoal, listGoals, type WorkItem } from "../api/client";

const { addError } = vi.hoisted(() => ({
  addError: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listGoals: vi.fn().mockResolvedValue([]),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  createGoalAction: vi.fn(),
  updateGoalAction: vi.fn(),
  decomposeGoal: vi.fn(),
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

const sampleGoal = {
  id: "g1",
  title: "学习 Rust",
  description: "实践",
  work_type: "goal",
  parent_work_id: null,
  status: "active",
  priority: 0,
  dependencies_json: null,
  executable_plan: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-15T00:00:00Z",
  completed_at: null,
  progress: 0.3,
  importance: 0.5,
  urgency: 0.5,
  deadline: null,
  last_activity_at: "2026-06-15T00:00:00Z",
  actions: [],
  events: [],
} as WorkItem;

function renderGoals(path = "/goals") {
  return renderWithRouter(
    <Routes>
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/goals/:goalId" element={<GoalsPage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe("GoalsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listGoals).mockResolvedValue([]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
  });

  it("renders the goals page with title", () => {
    const { container } = renderGoals();

    expect(screen.getByRole("heading", { name: "目标" })).toBeInTheDocument();
    const newButtons = screen.getAllByText("+ 新建");
    expect(newButtons.length).toBeGreaterThan(0);
    expect(container.querySelector(".page-shell .page-container")).toBeTruthy();
    expect(container.querySelector(".flex.h-full")).toBeNull();
  });

  it("shows create input after clicking + 新建", () => {
    renderGoals();

    fireEvent.click(screen.getAllByText("+ 新建")[0]);

    expect(screen.getByPlaceholderText(/目标名称/)).toBeInTheDocument();
  });

  it("keeps the list and detail placeholder in one page shell", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    renderGoals("/goals");

    const row = await screen.findByRole("link", { name: /学习 Rust/ });
    expect(row).toHaveAttribute("href", "/goals/g1");
    expect(row).toHaveClass("focus-visible:ring-focus-ring");
    expect(row).not.toHaveAttribute("aria-current");
    const list = screen.getByRole("region", { name: "目标列表" });
    const detail = screen.getByRole("region", { name: "目标详情" });
    expect(list).not.toHaveClass("hidden");
    expect(detail).toHaveClass("hidden", "lg:block");
    expect(screen.getByText("选择一个目标")).toBeInTheDocument();
  });

  it("opens the detail on narrow screens and shows ratio progress as a percent", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    renderGoals("/goals/g1");

    expect(await screen.findByText("进度 30%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "目标列表" })).toHaveClass("hidden", "lg:block");
    const back = screen.getByRole("link", { name: "返回列表" });
    expect(back).toHaveAttribute("href", "/goals");
    expect(back).toHaveClass("focus-visible:ring-focus-ring");
    expect(back.parentElement).toHaveClass("lg:hidden");
    const row = screen.getByRole("link", { name: /学习 Rust/ });
    expect(row).toHaveTextContent("30%");
    expect(row).toHaveAttribute("aria-current", "page");
  });

  it("encodes a goal id that contains a slash", async () => {
    vi.mocked(listGoals).mockResolvedValue([{ ...sampleGoal, id: "goal/2", title: "斜杠目标" }]);
    renderGoals("/goals");

    expect(await screen.findByRole("link", { name: /斜杠目标/ })).toHaveAttribute(
      "href",
      "/goals/goal%2F2",
    );
  });

  it("shows the empty list after a successful read", async () => {
    renderGoals();
    expect(await screen.findByText("暂无目标")).toBeInTheDocument();
    expect(screen.getByText("创建第一个目标，让 AI 帮你追踪进度")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retry when the goal list fails to load", async () => {
    vi.mocked(listGoals).mockRejectedValue(new ApiError("加载失败", 500));
    renderGoals();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "目标");
    expect(screen.getByRole("heading", { name: "目标" })).toBeInTheDocument();
    expect(screen.queryByText("暂无目标")).not.toBeInTheDocument();
    expect(screen.queryByText("创建第一个目标，让 AI 帮你追踪进度")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the page fallback when the goal list error has no message", async () => {
    vi.mocked(listGoals).mockRejectedValue(new ApiError("   ", 500));
    renderGoals();
    expect(await screen.findByRole("alert")).toHaveTextContent("加载目标失败");
    expect(addError).toHaveBeenCalledWith("加载目标失败", "目标");
    expect(screen.queryByText("暂无目标")).not.toBeInTheDocument();
  });

  it("keeps the goal list retry mounted until the reread finishes", async () => {
    let release: ((rows: WorkItem[]) => void) | undefined;
    vi.mocked(listGoals).mockRejectedValueOnce(new ApiError("加载失败", 500));
    renderGoals();
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    vi.mocked(listGoals).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("goals-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无目标")).not.toBeInTheDocument();

    release?.([]);
    expect(await screen.findByText("暂无目标")).toBeInTheDocument();
    expect(screen.queryByTestId("goals-load-error")).not.toBeInTheDocument();
  });

  it("keeps a loaded goal when the detail read fails and retries", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockRejectedValue(new ApiError("详情失败", 500));
    renderGoals("/goals/g1");

    const alert = await screen.findByTestId("goal-detail-load-error", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("详情失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("目标不存在")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /学习 Rust/ })).toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy", "true"), { timeout: 4000 });
    await waitFor(() => expect(retry).toHaveFocus());

    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    fireEvent.click(retry);
    expect(await screen.findByText("进度 30%")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-detail-load-error")).not.toBeInTheDocument();
  });

  it("keeps not-found copy when the goal detail is missing", async () => {
    vi.mocked(listGoals).mockResolvedValue([]);
    vi.mocked(getGoal).mockRejectedValue(new ApiError("missing", 404));
    renderGoals("/goals/missing");
    expect(await screen.findByText("目标不存在")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-detail-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无目标")).not.toBeInTheDocument();
  });

  it("shows the list failure beside an open goal without taking focus", async () => {
    vi.mocked(listGoals).mockRejectedValue(new ApiError("列表失败", 500));
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    renderGoals("/goals/g1");

    expect(await screen.findByText("进度 30%")).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "目标列表" });
    const alert = within(list).getByRole("alert");
    expect(alert).toHaveTextContent("列表失败");
    expect(within(list).queryByText("暂无其他目标")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无目标")).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "重试" })).not.toHaveFocus();
  });
});
