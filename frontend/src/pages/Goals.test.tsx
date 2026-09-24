import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import GoalsPage from "./Goals";
import GoalDetailPanel from "../components/goals/GoalDetailPanel";
import {
  ApiError,
  createGoal,
  createGoalAction,
  decomposeGoal,
  getGoal,
  listGoals,
  type WorkItem,
} from "../api/client";

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

  it("does not create a goal while an IME composition is confirming", () => {
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学习" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(createGoal).not.toHaveBeenCalled();
    expect(input).toHaveValue("学习");
  });

  it("keeps the new goal title when create fails, and ignores a second Enter while creating", async () => {
    vi.mocked(createGoal).mockRejectedValueOnce(new ApiError("创建目标失败", 500));
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "  学习 Rust  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建目标失败", "目标"));
    expect(createGoal).toHaveBeenCalledWith({ title: "学习 Rust" });
    expect(input).toHaveValue("  学习 Rust  ");
    expect(screen.getByPlaceholderText("目标名称...")).toBeEnabled();

    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建中..." })).toBeDisabled());
    expect(createGoal).toHaveBeenCalledTimes(2);

    release({ ...sampleGoal, title: "学习 Rust" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument(),
    );
  });

  it("keeps an action step when create fails and ignores IME Enter", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(createGoalAction).mockRejectedValueOnce(new ApiError("创建行动步骤失败", 500));
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(createGoalAction).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(createGoalAction).toHaveBeenCalledWith("g1", "写测试");
    expect(input).toHaveValue("写测试");
    expect(input).toBeEnabled();
  });

  it("keeps a suggested step when adding it fails", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(decomposeGoal).mockResolvedValue({ steps: ["先写测试"] });
    vi.mocked(createGoalAction).mockRejectedValueOnce(new ApiError("创建行动步骤失败", 500));
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByText("先写测试")).toBeInTheDocument();
    const row = screen.getByText("先写测试").parentElement;
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(screen.getByText("先写测试")).toBeInTheDocument();
  });
});

describe("GoalDetailPanel drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel(goal: WorkItem) {
    return renderWithRouter(
      <GoalDetailPanel
        goal={goal}
        onStartChat={vi.fn()}
        onUpdateStatus={vi.fn()}
        onRequestDelete={vi.fn()}
        onCreatedAction={vi.fn()}
      />,
    );
  }

  it("drops an unsent step and pending suggestions when the goal changes", async () => {
    const other = { ...sampleGoal, id: "g2", title: "学钢琴" };
    vi.mocked(decomposeGoal).mockResolvedValue({ steps: ["只属于这个目标"] });
    const view = renderPanel(sampleGoal);
    const input = screen.getByPlaceholderText("添加行动步骤...");
    fireEvent.change(input, { target: { value: "还没发出" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByText("只属于这个目标")).toBeInTheDocument();

    view.rerender(
      <GoalDetailPanel
        goal={other}
        onStartChat={vi.fn()}
        onUpdateStatus={vi.fn()}
        onRequestDelete={vi.fn()}
        onCreatedAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "学钢琴" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("添加行动步骤...")).toHaveValue("");
    expect(screen.queryByText("只属于这个目标")).not.toBeInTheDocument();
    expect(screen.queryByText("还没发出")).not.toBeInTheDocument();
  });

  it("does not apply a decompose result or clear the next draft after switching goals", async () => {
    const other = { ...sampleGoal, id: "g2", title: "学钢琴" };
    let releaseDecompose: (value: { steps: string[] }) => void = () => {};
    let releaseCreate: (goal: WorkItem) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseDecompose = resolve;
        }),
    );
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const view = renderPanel(sampleGoal);
    const input = screen.getByPlaceholderText("添加行动步骤...");
    fireEvent.change(input, { target: { value: "草稿A" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 拆解" }));

    view.rerender(
      <GoalDetailPanel
        goal={other}
        onStartChat={vi.fn()}
        onUpdateStatus={vi.fn()}
        onRequestDelete={vi.fn()}
        onCreatedAction={vi.fn()}
      />,
    );
    const next = screen.getByPlaceholderText("添加行动步骤...");
    expect(next).toHaveValue("");
    fireEvent.change(next, { target: { value: "草稿B" } });

    await act(async () => {
      releaseDecompose({ steps: ["不该出现"] });
      releaseCreate(sampleGoal);
    });

    expect(screen.queryByText("不该出现")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("添加行动步骤...")).toHaveValue("草稿B");
    expect(createGoalAction).toHaveBeenCalledTimes(1);
    expect(createGoalAction).toHaveBeenCalledWith("g1", "草稿A");
  });
});
