import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import GoalsPage, { goalPageLayoutFocus } from "./Goals";
import GoalDetailPanel from "../components/goals/GoalDetailPanel";
import {
  ApiError,
  createGoal,
  createConversation,
  createGoalAction,
  decomposeGoal,
  deleteGoal,
  getGoal,
  listGoals,
  updateGoal,
  updateGoalAction,
  type Conversation,
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

vi.mock("../stores/chatStore", () => {
  const state = {
    conversations: [] as Conversation[],
    addConversation: vi.fn(),
    setActiveConversation: vi.fn(),
    setPendingPrompt: vi.fn(),
    setConversations: vi.fn(),
  };
  return {
    useChatStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

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
  /** 确认框卸下的那一轮，绘制前焦点已经在下一行上。useEffect 会先停在页面空白。 */
  function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
    let focusAtLayout: Element | null = null;
    goalPageLayoutFocus.notify = () => {
      if (!gone()) return;
      focusAtLayout ??= document.activeElement;
    };
    return {
      read: () => focusAtLayout,
    };
  }

  beforeEach(() => {
    goalPageLayoutFocus.notify = null;
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

  it("writes the same status words as the detail on each list row", async () => {
    const recent = new Date().toISOString();
    vi.mocked(listGoals).mockResolvedValue([
      { ...sampleGoal, id: "active", title: "正在做", last_activity_at: recent },
      {
        ...sampleGoal,
        id: "stale",
        title: "放下了",
        last_activity_at: "2000-01-01T00:00:00Z",
      },
      {
        ...sampleGoal,
        id: "paused",
        title: "先停一下",
        status: "paused",
        last_activity_at: "2000-01-01T00:00:00Z",
      },
      {
        ...sampleGoal,
        id: "done",
        title: "做完了",
        status: "completed",
        last_activity_at: "2000-01-01T00:00:00Z",
      },
      {
        ...sampleGoal,
        id: "other",
        title: "别的状态",
        status: "queued",
        last_activity_at: recent,
      },
    ]);
    renderGoals("/goals");

    const active = await screen.findByRole("link", { name: /正在做/ });
    expect(active).toHaveAccessibleName(/正在做[\s\S]*进行中 30%/);
    expect(active).not.toHaveAccessibleName(/已停滞/);
    expect(active.querySelector("[aria-hidden='true']")).toHaveClass("rounded-full", "bg-success");

    const stale = screen.getByRole("link", { name: /放下了/ });
    expect(stale).toHaveAccessibleName(/进行中 · 已停滞 30%/);
    expect(stale.querySelector("[aria-hidden='true']")).toHaveClass("ring-warning");

    const paused = screen.getByRole("link", { name: /先停一下/ });
    expect(paused).toHaveAccessibleName(/已暂停 30%/);
    expect(paused).not.toHaveAccessibleName(/已停滞|进行中/);
    expect(paused.querySelector("[aria-hidden='true']")).toHaveClass("bg-fg-tertiary");

    const done = screen.getByRole("link", { name: /做完了/ });
    expect(done).toHaveAccessibleName(/已完成 30%/);
    expect(done).not.toHaveAccessibleName(/已停滞/);
    expect(screen.getByText("已完成 (1)")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /别的状态/ })).toHaveAccessibleName(/queued 30%/);
  });

  it("writes the full goal title when the row is keyboard focused", async () => {
    const title = "把实验笔记、论文和还没回的邮件收成一个可以每周核对的目标";
    vi.mocked(listGoals).mockResolvedValue([{ ...sampleGoal, title }]);
    renderGoals("/goals");

    const row = await screen.findByRole("link", { name: new RegExp(title) });
    const line = row.querySelector(".truncate");
    expect(line).toHaveTextContent(title);
    expect(line).toHaveClass(
      "truncate",
      "group-focus-visible:overflow-visible",
      "group-focus-visible:whitespace-normal",
      "group-focus-visible:text-clip",
    );
    expect(line?.className).not.toContain("group-hover:");
    expect(row).toHaveClass("group");
  });

  it("opens the detail on narrow screens and shows ratio progress as a percent", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    renderGoals("/goals/g1");

    expect(await screen.findByText("进度 30%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "目标列表" })).toHaveClass("hidden", "lg:block");
    const back = screen.getByRole("link", { name: "返回列表" });
    expect(back).toHaveAttribute("href", "/goals");
    expect(back).toHaveClass(
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(back.className).not.toContain("ring-offset");
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
    expect(input).toHaveClass("focus-visible:ring-focus-ring");
    expect(input.className.split(/\s+/)).not.toContain("outline-none");
    fireEvent.change(input, { target: { value: "学习" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(createGoal).not.toHaveBeenCalled();
    expect(input).toHaveValue("学习");
  });

  it("keeps the new goal title when create fails, and ignores a second Enter while creating", async () => {
    vi.mocked(createGoal).mockRejectedValueOnce(new ApiError("创建目标失败", 500));
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    input.focus();
    fireEvent.change(input, { target: { value: "  学习 Rust  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建目标失败", "目标"));
    expect(createGoal).toHaveBeenCalledWith({ title: "学习 Rust" });
    expect(input).toHaveValue("  学习 Rust  ");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();

    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    const pending = await screen.findByRole("button", { name: "创建中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    fireEvent.click(pending);
    expect(createGoal).toHaveBeenCalledTimes(2);

    release({ ...sampleGoal, title: "学习 Rust" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument(),
    );
    const opener = screen.getAllByRole("button", { name: "+ 新建" })[0];
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("moves focus to the new goal after create succeeds from the button", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学钢琴" } });
    const create = screen.getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    const pending = await screen.findByRole("button", { name: "创建中..." });
    expect(pending).toHaveFocus();
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(input).toBeEnabled();
    fireEvent.click(pending);
    expect(createGoal).toHaveBeenCalledTimes(1);

    const created = { ...sampleGoal, id: "g-new", title: "学钢琴" };
    vi.mocked(listGoals).mockResolvedValue([created]);
    release(created);
    const row = await screen.findByRole("link", { name: /学钢琴/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument();
  });

  it("parks focus on 新建 when create collapses the form before the new row exists", async () => {
    let releaseCreate: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    let releaseList: (rows: WorkItem[]) => void = () => {};
    let gateList = false;
    vi.mocked(listGoals).mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!gateList) {
            resolve([sampleGoal]);
            return;
          }
          releaseList = resolve;
        }),
    );

    renderGoals();
    const existing = await screen.findByRole("link", { name: /学习 Rust/ });
    const opener = screen.getAllByRole("button", { name: "+ 新建" })[0];
    fireEvent.click(opener);
    fireEvent.change(screen.getByPlaceholderText("目标名称..."), { target: { value: "学钢琴" } });
    const create = screen.getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    await screen.findByRole("button", { name: "创建中..." });
    gateList = true;

    let focusWhenCollapsed: Element | null = null;
    const collapseObserver = new MutationObserver(() => {
      if (document.querySelector("[data-goal-anchor='create']")) return;
      focusWhenCollapsed ??= document.activeElement;
    });
    collapseObserver.observe(document.body, { childList: true, subtree: true });

    const created = { ...sampleGoal, id: "g-new", title: "学钢琴" };
    await act(async () => {
      releaseCreate(created);
    });
    expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument();
    expect(focusWhenCollapsed).toBe(opener);
    expect(opener).toHaveFocus();
    expect(screen.queryByRole("link", { name: /学钢琴/ })).not.toBeInTheDocument();

    existing.focus();
    await act(async () => {
      releaseList([sampleGoal, created]);
    });
    expect(await screen.findByRole("link", { name: /学钢琴/ })).toBeInTheDocument();
    expect(existing).toHaveFocus();
    collapseObserver.disconnect();
  });

  it("moves from 新建 to the new goal in the same turn the row appears", async () => {
    let releaseCreate: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    let releaseList: (rows: WorkItem[]) => void = () => {};
    let gateList = false;
    vi.mocked(listGoals).mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!gateList) {
            resolve([]);
            return;
          }
          releaseList = resolve;
        }),
    );

    renderGoals();
    const opener = await screen.findByRole("button", { name: "+ 新建" });
    fireEvent.click(opener);
    fireEvent.change(screen.getByPlaceholderText("目标名称..."), { target: { value: "学钢琴" } });
    const create = screen.getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    await screen.findByRole("button", { name: "创建中..." });
    gateList = true;

    const created = { ...sampleGoal, id: "g-new", title: "学钢琴" };
    await act(async () => {
      releaseCreate(created);
    });
    expect(opener).toHaveFocus();

    let focusWhenRow: Element | null = null;
    const rowObserver = new MutationObserver(() => {
      const link = document.querySelector("a[data-goal-id='g-new']");
      if (!link) return;
      focusWhenRow ??= document.activeElement;
    });
    rowObserver.observe(document.body, { childList: true, subtree: true });
    await act(async () => {
      releaseList([created]);
    });
    const row = await screen.findByRole("link", { name: /学钢琴/ });
    expect(focusWhenRow).toBe(row);
    expect(row).toHaveFocus();
    rowObserver.disconnect();
  });

  it("keeps 创建 enabled while a cleared title is still saving, then leaves the disabled button", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals();
    fireEvent.click(screen.getAllByRole("button", { name: "+ 新建" })[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学钢琴" } });
    const create = screen.getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    const pending = await screen.findByRole("button", { name: "创建中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveFocus();
    fireEvent.change(input, { target: { value: "" } });
    expect(pending).toBeEnabled();
    expect(pending).toHaveFocus();

    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!pending.hasAttribute("disabled")) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(pending, { attributes: true, attributeFilter: ["disabled"] });
    release({ ...sampleGoal, id: "g-new", title: "学钢琴" });
    await waitFor(() => expect(pending).toBeDisabled());
    expect(focusWhenDisabled).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    expect(screen.getByPlaceholderText("目标名称...")).toBeInTheDocument();
    observer.disconnect();
  });

  it("keeps a title typed during create and does not pull focus back", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    input.focus();
    fireEvent.change(input, { target: { value: "学钢琴" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "创建中..." });
    fireEvent.change(input, { target: { value: "学钢琴，也学围棋" } });
    const opener = screen.getAllByRole("button", { name: "+ 新建" })[0];
    opener.focus();

    release({ ...sampleGoal, id: "g-new", title: "学钢琴" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "创建中..." })).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue("学钢琴，也学围棋");
    expect(opener).toHaveFocus();
    expect(createGoal).toHaveBeenCalledTimes(1);
    expect(createGoal).toHaveBeenCalledWith({ title: "学钢琴" });
  });

  it("returns focus to 新建 in the same turn 取消 closes the form", () => {
    renderGoals();
    const opener = screen.getAllByRole("button", { name: "+ 新建" })[0];
    fireEvent.click(opener);
    fireEvent.change(screen.getByPlaceholderText("目标名称..."), { target: { value: "学钢琴" } });
    const cancel = screen.getByRole("button", { name: "取消" });
    cancel.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByPlaceholderText("目标名称..."));
    fireEvent.click(cancel);
    expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(opener);
    expect(opener).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.click(opener);
    expect(screen.getByPlaceholderText("目标名称...")).toHaveValue("");
  });

  it("closes the create form on Escape and returns focus to 新建", () => {
    renderGoals();
    const opener = screen.getAllByRole("button", { name: "+ 新建" })[0];
    fireEvent.click(opener);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学钢琴" } });
    input.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByPlaceholderText("目标名称..."));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(opener);
    expect(opener).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.click(opener);
    expect(screen.getByPlaceholderText("目标名称...")).toHaveValue("");
  });

  it("does not close the create form on Escape while an input method is composing", () => {
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学习" } });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Process" });
    expect(screen.getByPlaceholderText("目标名称...")).toHaveValue("学习");
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("does not close the create form while creating", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals();
    fireEvent.click(screen.getAllByText("+ 新建")[0]);
    const input = screen.getByPlaceholderText("目标名称...");
    fireEvent.change(input, { target: { value: "学钢琴" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const pending = await screen.findByRole("button", { name: "创建中..." });
    const cancel = screen.getByRole("button", { name: "取消" });
    cancel.focus();
    fireEvent.click(cancel);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByPlaceholderText("目标名称...")).toBeInTheDocument();
    expect(input).toHaveValue("学钢琴");
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(cancel).toBeEnabled();
    expect(createGoal).toHaveBeenCalledTimes(1);

    release({ ...sampleGoal, id: "g-new", title: "学钢琴" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument(),
    );
  });

  it("does not steal focus when 取消 closes the form after focus already moved", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    renderGoals();
    const row = await screen.findByRole("link", { name: /学习 Rust/ });
    fireEvent.click(screen.getAllByRole("button", { name: "+ 新建" })[0]);
    const cancel = screen.getByRole("button", { name: "取消" });
    row.focus();
    fireEvent.click(cancel);
    expect(screen.queryByPlaceholderText("目标名称...")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it("keeps an action step when create fails and ignores IME Enter", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(createGoalAction).mockRejectedValueOnce(new ApiError("创建行动步骤失败", 500));
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    expect(input).toHaveClass("focus-visible:ring-focus-ring");
    input.focus();
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(createGoalAction).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(createGoalAction).toHaveBeenCalledWith("g1", "写测试");
    expect(input).toHaveValue("写测试");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("keeps the action field while a step is saving, then returns focus to it", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoalAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    fireEvent.change(input, { target: { value: "写测试" } });
    const add = screen.getByRole("button", { name: "添加" });
    add.focus();
    fireEvent.click(add);
    const pending = await screen.findByRole("button", { name: "添加中..." });
    expect(pending).toHaveFocus();
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(input).toBeEnabled();
    fireEvent.click(pending);
    expect(createGoalAction).toHaveBeenCalledTimes(1);

    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!add.hasAttribute("disabled")) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(add, { attributes: true, attributeFilter: ["disabled"] });
    release(sampleGoal);
    await waitFor(() => expect(input).toHaveValue(""));
    expect(focusWhenDisabled).toBe(input);
    expect(add).toBeDisabled();
    expect(input).toHaveFocus();
    expect(input).toBeEnabled();
    observer.disconnect();
  });

  it("reads 已添加 when a typed step succeeds and leaves focus in the field", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(createGoalAction).mockResolvedValue(sampleGoal);
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    input.focus();
    fireEvent.change(input, { target: { value: "  写测试  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已添加 写测试");
    expect(status).toHaveClass("sr-only");
    expect(status).not.toHaveFocus();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not read 添加中 or a failed step", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    let rejectCreate: (err: unknown) => void = () => {};
    vi.mocked(createGoalAction).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectCreate = reject;
        }),
    );
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    input.focus();
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "添加中..." })).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      rejectCreate(new ApiError("创建行动步骤失败", 500));
    });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(input).toHaveFocus();
    expect(input).toHaveValue("写测试");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads the step that was saved when the draft changes during add", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoalAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    input.focus();
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "添加中..." });
    fireEvent.change(input, { target: { value: "写测试，再补文档" } });

    await act(async () => {
      release(sampleGoal);
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已添加 写测试");
    expect(input).toHaveValue("写测试，再补文档");
    expect(input).toHaveFocus();
  });

  it("reads 已添加 again when the same step is added twice", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(createGoalAction).mockResolvedValue(sampleGoal);
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    input.focus();
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const first = await screen.findByRole("status");
    expect(first).toHaveTextContent("已添加 写测试");

    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("status")).not.toBe(first));
    expect(screen.getByRole("status")).toHaveTextContent("已添加 写测试");
    expect(input).toHaveFocus();
  });

  it("keeps text typed during an action save and does not pull focus back", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoalAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const input = await screen.findByPlaceholderText("添加行动步骤...");
    input.focus();
    fireEvent.change(input, { target: { value: "写测试" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "添加中..." });
    fireEvent.change(input, { target: { value: "写测试，再补文档" } });
    const chat = screen.getByRole("button", { name: "就此目标对话" });
    chat.focus();

    release(sampleGoal);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "添加中..." })).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue("写测试，再补文档");
    expect(chat).toHaveFocus();
    expect(createGoalAction).toHaveBeenCalledTimes(1);
    expect(createGoalAction).toHaveBeenCalledWith("g1", "写测试");
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

  it("keeps the delete dialog open until delete succeeds and ignores dismiss while deleting", async () => {
    let fail: (err: unknown) => void = () => {};
    vi.mocked(deleteGoal).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    renderGoals("/goals/g1");

    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除目标" });
    expect(dialog).toHaveTextContent("学习 Rust");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除中..." }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);

    const pending = await within(dialog).findByRole("button", { name: "删除中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(deleteGoal).toHaveBeenCalledTimes(1);
    expect(deleteGoal).toHaveBeenCalledWith("g1");
    expect(dialog).toHaveTextContent("学习 Rust");
    expect(dialog).toBeInTheDocument();

    fail(new ApiError("删除目标失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("删除目标失败", "目标"));
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("学习 Rust");
    expect(within(dialog).getByRole("button", { name: "删除" })).toBeEnabled();

    vi.mocked(deleteGoal).mockResolvedValueOnce(undefined);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除目标" })).not.toBeInTheDocument(),
    );
    expect(deleteGoal).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the next goal after delete", async () => {
    const next = { ...sampleGoal, id: "g2", title: "写文档", progress: 0 };
    vi.mocked(listGoals).mockResolvedValue([sampleGoal, next]);
    vi.mocked(deleteGoal).mockResolvedValue(undefined);
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除目标" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("dialog", { name: "删除目标" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除目标" })).not.toBeInTheDocument(),
    );
    const link = screen.getByRole("link", { name: /写文档/ });
    expect(link).toHaveFocus();
    expect(focusWhenGone.read()).toBe(link);
  });

  it("moves focus to the previous goal when the last one is deleted", async () => {
    const last = { ...sampleGoal, id: "g2", title: "写文档", progress: 0 };
    vi.mocked(listGoals).mockResolvedValue([sampleGoal, last]);
    vi.mocked(getGoal).mockResolvedValue(last);
    vi.mocked(deleteGoal).mockResolvedValue(undefined);
    renderGoals("/goals/g2");
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除目标" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除目标" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /学习 Rust/ })).toHaveFocus();
  });

  it("moves focus to 新建 when the only goal is deleted", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(deleteGoal).mockResolvedValue(undefined);
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除目标" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除目标" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "+ 新建" })).toHaveFocus();
  });

  it("does not pull goal delete focus back when it already moved", async () => {
    const next = { ...sampleGoal, id: "g2", title: "写文档", progress: 0 };
    vi.mocked(listGoals).mockResolvedValue([sampleGoal, next]);
    let release: () => void = () => {};
    vi.mocked(deleteGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除目标" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const create = screen.getByRole("button", { name: "+ 新建" });
    create.focus();

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除目标" })).not.toBeInTheDocument(),
    );
    expect(create).toHaveFocus();
  });

  it("does not send a second status write, keeps focus, then moves it to 恢复", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const pause = await screen.findByRole("button", { name: "暂停" });
    const done = screen.getByRole("button", { name: "完成" });
    pause.focus();
    fireEvent.click(pause);
    fireEvent.click(pause);
    fireEvent.click(done);
    await waitFor(() => expect(pause).toHaveAttribute("aria-busy", "true"));
    expect(pause).not.toBeDisabled();
    expect(pause).toHaveFocus();
    expect(done).not.toHaveAttribute("aria-busy");
    expect(updateGoal).toHaveBeenCalledTimes(1);
    expect(updateGoal).toHaveBeenCalledWith("g1", { status: "paused" });

    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "暂停" }),
    );
    await act(async () => {
      release({ ...current, status: "paused" });
    });
    const resume = await screen.findByRole("button", { name: "恢复" });
    await waitFor(() => expect(resume).toHaveFocus());
    expect(focusWhenGone.read()).toBe(resume);
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(screen.queryByRole("button", { name: "暂停" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成" })).not.toBeInTheDocument();
  });

  it("moves focus to 暂停 after 恢复 succeeds", async () => {
    let current: WorkItem = { ...sampleGoal, status: "paused" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const resume = await screen.findByRole("button", { name: "恢复" });
    resume.focus();
    fireEvent.click(resume);
    fireEvent.click(resume);
    await waitFor(() => expect(resume).toHaveAttribute("aria-busy", "true"));
    expect(resume).not.toBeDisabled();
    expect(resume).toHaveFocus();
    expect(updateGoal).toHaveBeenCalledTimes(1);
    expect(updateGoal).toHaveBeenCalledWith("g1", { status: "active" });

    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "恢复" }),
    );
    await act(async () => {
      release({ ...current, status: "active" });
    });
    const pause = await screen.findByRole("button", { name: "暂停" });
    await waitFor(() => expect(pause).toHaveFocus());
    expect(focusWhenGone.read()).toBe(pause);
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "完成" })).not.toHaveFocus();
  });

  it("moves focus to 就此目标对话 after 完成, and does not steal it back", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const done = await screen.findByRole("button", { name: "完成" });
    const remove = screen.getByRole("button", { name: "删除" });
    done.focus();
    fireEvent.click(done);
    remove.focus();
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "完成" }),
    );
    await act(async () => {
      release({ ...current, status: "completed" });
    });
    expect(await screen.findByRole("button", { name: "就此目标对话" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完成" })).not.toBeInTheDocument();
    expect(remove).toHaveFocus();
    expect(focusWhenGone.read()).toBe(remove);
    expect(updateGoal).toHaveBeenCalledTimes(1);
  });

  it("focuses 就此目标对话 when 完成 finishes and focus was still on that button", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const done = await screen.findByRole("button", { name: "完成" });
    done.focus();
    fireEvent.click(done);
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(done).toHaveAttribute("aria-busy", "true"));
    expect(done).toHaveFocus();
    expect(done).not.toBeDisabled();
    expect(updateGoal).toHaveBeenCalledTimes(1);
    expect(updateGoal).toHaveBeenCalledWith("g1", { status: "completed" });

    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "完成" }),
    );
    await act(async () => {
      release({ ...current, status: "completed" });
    });
    const chat = await screen.findByRole("button", { name: "就此目标对话" });
    await waitFor(() => expect(chat).toHaveFocus());
    expect(focusWhenGone.read()).toBe(chat);
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("keeps 完成 focused when the status write fails", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let fail: (err: unknown) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderGoals("/goals/g1");
    const done = await screen.findByRole("button", { name: "完成" });
    done.focus();
    fireEvent.click(done);
    fireEvent.click(done);
    await waitFor(() => expect(done).toHaveAttribute("aria-busy", "true"));
    expect(done).not.toBeDisabled();
    expect(done).toHaveFocus();
    expect(updateGoal).toHaveBeenCalledTimes(1);

    fail(new ApiError("更新目标状态失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("更新目标状态失败", "目标"));
    expect(done).toHaveFocus();
    expect(done).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "暂停" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reads 已暂停 when 暂停 succeeds and leaves focus on 恢复", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    expect(await screen.findByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("已停滞")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const pause = screen.getByRole("button", { name: "暂停" });
    pause.focus();
    fireEvent.click(pause);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      release({ ...current, status: "paused" });
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^已暂停$/);
    expect(status).toHaveClass("sr-only");
    expect(status).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "恢复" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads 已完成 when 完成 succeeds without taking focus", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const remove = await screen.findByRole("button", { name: "删除" });
    const done = screen.getByRole("button", { name: "完成" });
    done.focus();
    fireEvent.click(done);
    remove.focus();
    await act(async () => {
      release({ ...current, status: "completed" });
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^已完成$/);
    expect(status).not.toHaveFocus();
    expect(remove).toHaveFocus();
  });

  it("reads 进行中 · 已停滞 when a stale goal is resumed", async () => {
    let current: WorkItem = { ...sampleGoal, status: "paused" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    const resume = await screen.findByRole("button", { name: "恢复" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    resume.focus();
    fireEvent.click(resume);
    await act(async () => {
      release({ ...current, status: "active" });
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^进行中 · 已停滞$/);
    expect(screen.getByRole("button", { name: "暂停" })).toHaveFocus();
  });

  it("reads 进行中 when a recent goal is resumed", async () => {
    let current: WorkItem = {
      ...sampleGoal,
      status: "paused",
      last_activity_at: new Date().toISOString(),
    };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    await act(async () => {
      release({ ...current, status: "active" });
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^进行中$/);
  });

  it("reads the badge word when the saved status has no known label", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "完成" }));
    await act(async () => {
      release({ ...current, status: "archived" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/^archived$/);
    expect(screen.getByText("archived", { selector: ":not([role='status'])" })).toBeInTheDocument();
  });

  it("reads 已暂停 again after the goal is resumed and paused", async () => {
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    const pending: Array<(goal: WorkItem) => void> = [];
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push((goal) => {
            current = goal;
            resolve(goal);
          });
        }),
    );
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "暂停" }));
    await act(async () => {
      pending[0]({ ...current, status: "paused" });
    });
    const first = await screen.findByRole("status");
    expect(first).toHaveTextContent(/^已暂停$/);

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await act(async () => {
      pending[1]({ ...current, status: "active" });
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^进行中 · 已停滞$/));
    const mid = screen.getByRole("status");
    expect(mid).not.toBe(first);

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    await act(async () => {
      pending[2]({ ...current, status: "paused" });
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^已暂停$/));
    const again = screen.getByRole("status");
    expect(again).not.toBe(mid);
  });

  it("drops the previous status announcement when another goal opens", async () => {
    const other: WorkItem = { ...sampleGoal, id: "g2", title: "另一件事", status: "completed" };
    let current: WorkItem = { ...sampleGoal, status: "active" };
    vi.mocked(listGoals).mockImplementation(async () => [current, other]);
    vi.mocked(getGoal).mockImplementation(async (id: string) => (id === "g2" ? other : current));
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(updateGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (goal) => {
            current = goal;
            resolve(goal);
          };
        }),
    );
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "暂停" }));
    await act(async () => {
      release({ ...current, status: "paused" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/^已暂停$/);

    fireEvent.click(screen.getByRole("link", { name: /另一件事/ }));
    await screen.findByRole("heading", { name: "另一件事" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("does not toggle one action twice and keeps focus on that checkbox", async () => {
    const first = {
      ...sampleGoal,
      id: "a1",
      title: "写测试",
      work_type: "action",
      status: "pending",
      parent_work_id: "g1",
      actions: [],
    } as WorkItem;
    const second = { ...first, id: "a2", title: "再看一眼" };
    let current: WorkItem = { ...sampleGoal, actions: [first, second] };
    vi.mocked(listGoals).mockImplementation(async () => [current]);
    vi.mocked(getGoal).mockImplementation(async () => current);
    const pending: Array<(goal: WorkItem) => void> = [];
    vi.mocked(updateGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push((goal) => {
            current = goal;
            resolve(goal);
          });
        }),
    );
    renderGoals("/goals/g1");
    const box = await screen.findByRole("checkbox", { name: "写测试" });
    const other = screen.getByRole("checkbox", { name: "再看一眼" });
    expect(box).toHaveClass("focus-visible:ring-focus-ring");
    expect(other).toHaveClass("focus-visible:ring-focus-ring");
    box.focus();
    fireEvent.click(box);
    fireEvent.click(box);
    await waitFor(() => expect(box).toHaveAttribute("aria-busy", "true"));
    expect(box).not.toBeDisabled();
    expect(box).toHaveFocus();
    expect(box).not.toBeChecked();
    expect(updateGoalAction).toHaveBeenCalledTimes(1);
    expect(updateGoalAction).toHaveBeenCalledWith("g1", "a1", { status: "completed" });

    other.focus();
    fireEvent.click(other);
    await waitFor(() => expect(updateGoalAction).toHaveBeenCalledTimes(2));
    expect(updateGoalAction).toHaveBeenLastCalledWith("g1", "a2", { status: "completed" });
    expect(other).toHaveFocus();

    await act(async () => {
      const next = {
        ...current,
        actions: [
          { ...first, status: "completed" },
          { ...second, status: "completed" },
        ],
      };
      pending.forEach((finish) => finish(next));
    });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "写测试" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "再看一眼" })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "写测试" })).not.toHaveAttribute("aria-busy");
  });

  it("toggles an action when its visible step name is clicked", async () => {
    const step = {
      ...sampleGoal,
      id: "a1",
      title: "写测试",
      work_type: "action",
      status: "pending",
      parent_work_id: "g1",
      actions: [],
    } as WorkItem;
    const goal = { ...sampleGoal, actions: [step] };
    vi.mocked(listGoals).mockResolvedValue([goal]);
    vi.mocked(getGoal).mockResolvedValue(goal);
    vi.mocked(updateGoalAction).mockResolvedValue({ ...step, status: "completed" });
    renderGoals("/goals/g1");

    const box = await screen.findByRole("checkbox", { name: "写测试" });
    const name = screen.getByText("写测试");
    expect(name.closest("label")).toContainElement(box);
    expect(box).not.toHaveAttribute("aria-label");
    name.closest("label")?.click();
    await waitFor(() =>
      expect(updateGoalAction).toHaveBeenCalledWith("g1", "a1", { status: "completed" }),
    );
    expect(updateGoalAction).toHaveBeenCalledTimes(1);
  });

  it("names a blank action step 行动步骤", async () => {
    const step = {
      ...sampleGoal,
      id: "a1",
      title: "   ",
      work_type: "action",
      status: "pending",
      parent_work_id: "g1",
      actions: [],
    } as WorkItem;
    const goal = { ...sampleGoal, actions: [step] };
    vi.mocked(listGoals).mockResolvedValue([goal]);
    vi.mocked(getGoal).mockResolvedValue(goal);
    renderGoals("/goals/g1");

    const box = await screen.findByRole("checkbox", { name: "行动步骤" });
    expect(box).toHaveAttribute("aria-label", "行动步骤");
  });

  it("does not decompose twice and keeps focus on AI 拆解", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let release: (value: { steps: string[] }) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const button = await screen.findByRole("button", { name: "AI 拆解" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "AI 拆解中..." });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
    expect(decomposeGoal).toHaveBeenCalledTimes(1);
    expect(decomposeGoal).toHaveBeenCalledWith("g1");

    await act(async () => {
      release({ steps: ["先写测试"] });
    });
    expect(await screen.findByText("先写测试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus();
  });

  it("reads the suggestions when they appear and leaves focus on AI 拆解", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let release: (value: { steps: string[] }) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const button = await screen.findByRole("button", { name: "AI 拆解" });
    button.focus();
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "AI 拆解中..." });
    expect(busy).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      release({ steps: ["先写测试", "再补文档"] });
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("AI 建议的行动步骤 先写测试 再补文档");
    expect(status).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus();
    expect(status).not.toHaveFocus();
  });

  it("does not read 拆解中 or a failed decompose", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let rejectDecompose: (err: unknown) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDecompose = reject;
        }),
    );
    renderGoals("/goals/g1");
    const button = await screen.findByRole("button", { name: "AI 拆解" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "AI 拆解中..." })).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      rejectDecompose(new ApiError("拆解失败", 500));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(addError).toHaveBeenCalledWith("拆解失败", "目标");
  });

  it("reads the replacement suggestions and does not shorten that line when one is added", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(createGoalAction).mockResolvedValue(sampleGoal);
    vi.mocked(decomposeGoal).mockResolvedValueOnce({ steps: ["先写测试", "再补文档"] });
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "AI 拆解" }));
    const first = await screen.findByRole("status");
    expect(first).toHaveTextContent("AI 建议的行动步骤 先写测试 再补文档");

    let release: (value: { steps: string[] }) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const again = screen.getByRole("button", { name: "AI 拆解" });
    again.focus();
    fireEvent.click(again);
    expect(await screen.findByRole("button", { name: "AI 拆解中..." })).toHaveFocus();
    expect(screen.getByRole("status")).toBe(first);
    expect(first).toHaveTextContent("AI 建议的行动步骤 先写测试 再补文档");

    await act(async () => {
      release({ steps: ["先写测试", "再补文档"] });
    });
    const replaced = await screen.findByRole("status");
    expect(replaced).not.toBe(first);
    expect(replaced).toHaveTextContent("AI 建议的行动步骤 先写测试 再补文档");
    expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus();

    const row = screen.getByText("先写测试").parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(screen.queryByText("先写测试")).not.toBeInTheDocument());
    expect(screen.getByText("再补文档")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBe(replaced);
    expect(replaced).toHaveTextContent("AI 建议的行动步骤 先写测试 再补文档");
  });

  it("does not read an empty decompose result", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(decomposeGoal).mockResolvedValue({ steps: [] });
    renderGoals("/goals/g1");
    const button = await screen.findByRole("button", { name: "AI 拆解" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(decomposeGoal).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 建议的行动步骤")).not.toBeInTheDocument();
  });

  it("keeps listed suggestions while another decompose is in flight and after it fails", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(decomposeGoal).mockResolvedValueOnce({ steps: ["先写测试"] });
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByText("先写测试")).toBeInTheDocument();

    let rejectDecompose: (err: unknown) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDecompose = reject;
        }),
    );
    const again = screen.getByRole("button", { name: "AI 拆解" });
    again.focus();
    fireEvent.click(again);
    fireEvent.click(again);
    const busy = await screen.findByRole("button", { name: "AI 拆解中..." });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
    expect(screen.getByText("先写测试")).toBeInTheDocument();
    expect(decomposeGoal).toHaveBeenCalledTimes(2);

    await act(async () => {
      rejectDecompose(new ApiError("拆解失败", 500));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus());
    expect(screen.getByText("先写测试")).toBeInTheDocument();
    const row = screen.getByText("先写测试").parentElement as HTMLElement;
    expect(within(row).getByRole("button", { name: "添加" })).toBeEnabled();
    expect(addError).toHaveBeenCalledWith("拆解失败", "目标");
  });

  it("replaces listed suggestions only after the next decompose succeeds", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(decomposeGoal).mockResolvedValueOnce({ steps: ["先写测试"] });
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByText("先写测试")).toBeInTheDocument();

    let release: (value: { steps: string[] }) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const again = screen.getByRole("button", { name: "AI 拆解" });
    again.focus();
    fireEvent.click(again);
    expect(await screen.findByRole("button", { name: "AI 拆解中..." })).toBeInTheDocument();
    expect(screen.getByText("先写测试")).toBeInTheDocument();

    await act(async () => {
      release({ steps: ["改成写文档"] });
    });
    expect(await screen.findByText("改成写文档")).toBeInTheDocument();
    expect(screen.queryByText("先写测试")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 拆解" })).toHaveFocus();
  });

  it("does not pull focus back to AI 拆解 when it already moved", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let release: (value: { steps: string[] }) => void = () => {};
    vi.mocked(decomposeGoal).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const button = await screen.findByRole("button", { name: "AI 拆解" });
    const remove = screen.getByRole("button", { name: "删除" });
    button.focus();
    fireEvent.click(button);
    remove.focus();
    await act(async () => {
      release({ steps: ["先写测试"] });
    });
    expect(await screen.findByText("先写测试")).toBeInTheDocument();
    expect(remove).toHaveFocus();
  });

  async function showSuggestions(steps: string[]) {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(decomposeGoal).mockResolvedValue({ steps });
    renderGoals("/goals/g1");
    fireEvent.click(await screen.findByRole("button", { name: "AI 拆解" }));
    expect(await screen.findByText(steps[0])).toBeInTheDocument();
  }

  function suggestionAdd(title: string) {
    const row = screen.getByText(title).parentElement as HTMLElement;
    return within(row).getByRole("button", { name: /添加/ });
  }

  it("does not add a suggestion twice and keeps focus on that button", async () => {
    const pending: Array<(goal: WorkItem) => void> = [];
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    await showSuggestions(["先写测试", "再补文档"]);
    const add = suggestionAdd("先写测试");
    add.focus();
    fireEvent.click(add);
    fireEvent.click(add);
    const busy = await within(add.parentElement as HTMLElement).findByRole("button", {
      name: "添加中...",
    });
    expect(busy).toBeEnabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveFocus();
    expect(createGoalAction).toHaveBeenCalledTimes(1);

    const other = suggestionAdd("再补文档");
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");
    fireEvent.click(screen.getByRole("button", { name: "全部添加" }));
    expect(createGoalAction).toHaveBeenCalledTimes(1);

    other.focus();
    fireEvent.click(other);
    await waitFor(() => expect(createGoalAction).toHaveBeenCalledTimes(2));
    expect(other).toHaveAttribute("aria-busy", "true");
    expect(other).toHaveFocus();
    expect(createGoalAction).toHaveBeenNthCalledWith(1, "g1", "先写测试");
    expect(createGoalAction).toHaveBeenNthCalledWith(2, "g1", "再补文档");

    await act(async () => {
      pending.forEach((finish) => finish(sampleGoal));
    });
  });

  it("moves focus to the next suggestion after one is added, and does not steal it", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await showSuggestions(["先写测试", "再补文档"]);
    const add = suggestionAdd("先写测试");
    add.focus();
    fireEvent.click(add);
    await screen.findByRole("button", { name: "添加中..." });

    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("先写测试"));
    await act(async () => {
      release(sampleGoal);
    });
    await waitFor(() => expect(screen.queryByText("先写测试")).not.toBeInTheDocument());
    const next = suggestionAdd("再补文档");
    expect(next).toHaveFocus();
    expect(focusWhenGone.read()).toBe(next);
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(createGoalAction).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the previous suggestion when the last one is added", async () => {
    vi.mocked(createGoalAction).mockResolvedValue(sampleGoal);
    await showSuggestions(["先写测试", "再补文档"]);
    const add = suggestionAdd("再补文档");
    add.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("再补文档"));
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByText("再补文档")).not.toBeInTheDocument());
    const previous = suggestionAdd("先写测试");
    expect(previous).toHaveFocus();
    expect(focusWhenGone.read()).toBe(previous);
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("moves focus to the action field when the only suggestion is added", async () => {
    vi.mocked(createGoalAction).mockResolvedValue(sampleGoal);
    await showSuggestions(["先写测试"]);
    const add = suggestionAdd("先写测试");
    const input = screen.getByPlaceholderText("添加行动步骤...");
    add.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("先写测试"));
    fireEvent.click(add);
    await waitFor(() => expect(input).toHaveFocus());
    expect(focusWhenGone.read()).toBe(input);
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(screen.queryByText("先写测试")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部添加" })).not.toBeInTheDocument();
  });

  it("does not pull suggestion focus back when it already moved", async () => {
    let release: (goal: WorkItem) => void = () => {};
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await showSuggestions(["先写测试"]);
    const add = suggestionAdd("先写测试");
    const remove = screen.getByRole("button", { name: "删除" });
    add.focus();
    fireEvent.click(add);
    remove.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("先写测试"));
    await act(async () => {
      release(sampleGoal);
    });
    await waitFor(() => expect(screen.queryByText("先写测试")).not.toBeInTheDocument());
    expect(remove).toHaveFocus();
    expect(focusWhenGone.read()).toBe(remove);
  });

  it("keeps suggestion focus on failure and restores it from a blank page", async () => {
    let fail: (err: unknown) => void = () => {};
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await showSuggestions(["先写测试"]);
    const add = suggestionAdd("先写测试");
    add.focus();
    fireEvent.click(add);
    const pending = await screen.findByRole("button", { name: "添加中..." });
    expect(pending).toHaveFocus();
    pending.blur();
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      fail(new ApiError("创建行动步骤失败", 500));
    });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(screen.getByText("先写测试")).toBeInTheDocument();
    expect(suggestionAdd("先写测试")).toHaveFocus();
    expect(suggestionAdd("先写测试")).toBeEnabled();
    expect(suggestionAdd("先写测试")).not.toHaveAttribute("aria-busy");
  });

  it("does not add every suggestion twice and keeps focus on 全部添加", async () => {
    const pending: Array<(goal: WorkItem) => void> = [];
    vi.mocked(createGoalAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    await showSuggestions(["先写测试", "再补文档"]);
    const all = screen.getByRole("button", { name: "全部添加" });
    all.focus();
    fireEvent.click(all);
    fireEvent.click(all);
    const busy = await screen.findByRole("button", { name: "全部添加中..." });
    expect(busy).toBeEnabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveFocus();
    expect(suggestionAdd("先写测试")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(suggestionAdd("先写测试"));
    fireEvent.click(suggestionAdd("再补文档"));
    expect(createGoalAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0](sampleGoal);
    });
    await waitFor(() => expect(createGoalAction).toHaveBeenCalledTimes(2));
    expect(createGoalAction).toHaveBeenNthCalledWith(2, "g1", "再补文档");
    expect(screen.getByRole("button", { name: "全部添加中..." })).toHaveFocus();

    const input = screen.getByPlaceholderText("添加行动步骤...");
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: /全部添加/ }),
    );
    await act(async () => {
      pending[1](sampleGoal);
    });
    await waitFor(() => expect(input).toHaveFocus());
    expect(focusWhenGone.read()).toBe(input);
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(screen.queryByRole("button", { name: "全部添加" })).not.toBeInTheDocument();
    expect(createGoalAction).toHaveBeenCalledTimes(2);
  });

  it("keeps 全部添加 focused when one suggestion fails", async () => {
    vi.mocked(createGoalAction)
      .mockResolvedValueOnce(sampleGoal)
      .mockRejectedValueOnce(new ApiError("创建行动步骤失败", 500));
    await showSuggestions(["先写测试", "再补文档"]);
    const all = screen.getByRole("button", { name: "全部添加" });
    all.focus();
    fireEvent.click(all);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建行动步骤失败", "目标"));
    expect(screen.queryByText("先写测试")).not.toBeInTheDocument();
    expect(screen.getByText("再补文档")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部添加" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "全部添加" })).toBeEnabled();
    expect(createGoalAction).toHaveBeenCalledTimes(2);
  });

  it("does not open a second chat while 就此目标对话 is in flight", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    let release: (conv: Conversation) => void = () => {};
    vi.mocked(createConversation).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderGoals("/goals/g1");
    const chat = await screen.findByRole("button", { name: "就此目标对话" });
    const pause = screen.getByRole("button", { name: "暂停" });
    chat.focus();
    fireEvent.click(chat);
    fireEvent.click(chat);
    await waitFor(() => expect(chat).toHaveAttribute("aria-busy", "true"));
    expect(chat).toBeEnabled();
    expect(chat).toHaveFocus();
    expect(chat).toHaveClass("opacity-50");
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledWith("目标：学习 Rust");
    pause.focus();

    await act(async () => {
      release({ id: "c-goal", title: "目标：学习 Rust" } as Conversation);
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "就此目标对话" })).not.toBeInTheDocument(),
    );
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it("keeps focus on 就此目标对话 when opening the chat fails, and does not steal it", async () => {
    vi.mocked(listGoals).mockResolvedValue([sampleGoal]);
    vi.mocked(getGoal).mockResolvedValue(sampleGoal);
    vi.mocked(createConversation).mockRejectedValue(new ApiError("创建对话失败", 500));
    renderGoals("/goals/g1");
    const chat = await screen.findByRole("button", { name: "就此目标对话" });
    chat.focus();
    fireEvent.click(chat);
    fireEvent.click(chat);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建对话失败", "对话"));
    expect(chat).toHaveFocus();
    expect(chat).toBeEnabled();
    expect(chat).not.toHaveAttribute("aria-busy");
    expect(createConversation).toHaveBeenCalledTimes(1);

    let release: (err: unknown) => void = () => {};
    vi.mocked(createConversation).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          release = reject;
        }),
    );
    fireEvent.click(chat);
    await waitFor(() => expect(chat).toHaveAttribute("aria-busy", "true"));
    (chat as HTMLButtonElement).blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      release(new ApiError("创建对话失败", 500));
    });
    await waitFor(() => expect(chat).not.toHaveAttribute("aria-busy"));
    expect(chat).toHaveFocus();

    const pause = screen.getByRole("button", { name: "暂停" });
    fireEvent.click(chat);
    await waitFor(() => expect(chat).toHaveAttribute("aria-busy", "true"));
    pause.focus();
    await act(async () => {
      release(new ApiError("创建对话失败", 500));
    });
    await waitFor(() => expect(chat).not.toHaveAttribute("aria-busy"));
    expect(pause).toHaveFocus();
    expect(createConversation).toHaveBeenCalledTimes(3);
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
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(createGoalAction).toHaveBeenCalledTimes(1);
    expect(createGoalAction).toHaveBeenCalledWith("g1", "草稿A");
  });
});
