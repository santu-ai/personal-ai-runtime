import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

const { addError } = vi.hoisted(() => ({
  addError: vi.fn(),
}));
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import TasksPage, { taskPageLayoutFocus } from "./Tasks";
import {
  acceptWorkDelivery,
  adoptSuggestedAction,
  ApiError,
  cancelWorkItem,
  createProjectBrief,
  executeWorkItem,
  getDeliveryMetrics,
  getInboxEmailDetail,
  getWorkDelivery,
  getWorkItem,
  listWorkItems,
  rerunProjectBrief,
  scheduleBriefRepeat,
  reworkWorkDelivery,
  updateWorkItemStatus,
  type WorkDelivery,
  type WorkItem,
} from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    listWorkItems: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkDelivery: vi.fn(),
    executeWorkItem: vi.fn().mockResolvedValue({}),
    rerunProjectBrief: vi.fn().mockResolvedValue({}),
    scheduleBriefRepeat: vi.fn().mockResolvedValue({
      work_id: "brief_1",
      timer_id: "t_1",
      fire_at: "2026-09-24T08:00:00Z",
    }),
    cancelWorkItem: vi.fn(),
    createProjectBrief: vi.fn(),
    acceptWorkDelivery: vi.fn().mockResolvedValue({ replayed: false }),
    reworkWorkDelivery: vi.fn().mockResolvedValue({ replayed: false }),
    adoptSuggestedAction: vi.fn().mockResolvedValue({ replayed: false, work: { id: "todo_1" } }),
    updateWorkItemStatus: vi.fn().mockResolvedValue({}),
    getInboxEmailDetail: vi.fn(),
    getDeliveryMetrics: vi.fn().mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 0,
      accepted_tasks: 0,
      first_reviewed_tasks: 0,
      first_version_accepted_tasks: 0,
      first_version_acceptance_rate: null,
      rework_count: 0,
      adopted_action_count: 0,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: "unavailable",
        recovery_interventions: "unavailable",
        llm_cost: "unavailable",
        unattributed_project_brief_calls: "unavailable",
        unattributed_project_brief_cost: "unavailable",
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    }),
  };
});

vi.mock("../api/inbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/inbox")>();
  return {
    ...actual,
    getInboxEmailSummary: vi.fn().mockResolvedValue({
      email_id: "m1",
      subject: "延期邮件",
      sender: "a@example.com",
      summary: "排期推迟",
    }),
  };
});

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addError }),
}));

const sampleTask: WorkItem = {
  id: "task_1",
  title: "整理报告",
  description: null,
  work_type: "task",
  parent_work_id: null,
  status: "pending",
  priority: 0,
  dependencies_json: null,
  executable_plan: JSON.stringify({
    steps: [{ tool: "write_file" }, { tool: "send_email" }],
  }),
  created_at: "2026-08-06T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
  completed_at: null,
  progress: 0,
  importance: 0,
  urgency: 0,
  deadline: null,
  last_activity_at: null,
  execution: {
    steps: [{ tool: "write_file" }, { tool: "send_email" }],
    resume_from: 0,
    previous_output: { step_0_output: "wrote draft" },
    handler_execution: null,
  },
};

const currentDelivery: WorkDelivery = {
  delivery_id: "d2",
  version: 2,
  contract_version: 1,
  summary: "有进度风险",
  content: "完整正文超过预览长度".repeat(20),
  limitations: ["仅覆盖最近三天"],
  suggested_actions: [{ title: "核对排期" }],
  sources: [{ id: "email:m1", type: "email", title: "延期邮件" }],
  checks: [],
  findings: [],
  schema_version: 1,
  qualified: true,
  review_status: "unreviewed",
};

const historySummary: WorkDelivery = {
  delivery_id: "d1",
  version: 1,
  contract_version: 1,
  summary: "第一版摘要",
  content_length: 42,
  limitations: [],
  suggested_actions: [],
  sources: [],
  checks: [],
  findings: [],
  schema_version: 1,
  qualified: true,
  review_status: "changes_requested",
};

const historyFull: WorkDelivery = {
  ...historySummary,
  content: "历史版本完整正文甲",
};

const currentSummary: WorkDelivery = {
  delivery_id: "d2",
  version: 2,
  contract_version: 1,
  summary: "有进度风险",
  content_length: 200,
  limitations: [],
  suggested_actions: [],
  sources: [],
  checks: [],
  findings: [],
  schema_version: 1,
  qualified: true,
  review_status: "unreviewed",
};

const briefTask: WorkItem = {
  ...sampleTask,
  id: "brief_1",
  title: "项目 A 简报",
  description: "整理最近三天邮件",
  executable_plan: JSON.stringify({ kind: "project_brief", steps: [] }),
  status: "completed",
  execution: {
    steps: [{ tool: "check_inbox" }],
    resume_from: 1,
    previous_output: { step_0_output: "truncated" },
    handler_execution: null,
  },
  delivery_bundle: {
    work_id: "brief_1",
    current_review_status: "unreviewed",
    current: currentDelivery,
    deliveries: [historySummary, currentSummary],
  },
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockBriefList() {
  vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
    if (workType === "task") return [briefTask];
    return [];
  });
  vi.mocked(getWorkItem).mockResolvedValue(briefTask);
}

function currentTaskLink(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-task-current]");
  if (!node) throw new Error("missing current task link");
  return node;
}

function hideTaskList() {
  const original = window.getComputedStyle.bind(window);
  return vi.spyOn(window, "getComputedStyle").mockImplementation((elt: Element) => {
    const style = original(elt);
    if (!(elt instanceof HTMLElement) || elt.dataset.taskList === undefined) return style;
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === "display") return "none";
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

function asRunning(work: WorkItem): WorkItem {
  return {
    ...work,
    status: "running",
    execution: work.execution
      ? { ...work.execution, handler_execution: null }
      : {
          steps: [],
          resume_from: 0,
          previous_output: {},
          handler_execution: null,
        },
  };
}

function withReview(work: WorkItem, status: "accepted" | "changes_requested"): WorkItem {
  const bundle = work.delivery_bundle;
  if (!bundle?.current) return work;
  return {
    ...work,
    delivery_bundle: {
      ...bundle,
      current_review_status: status,
      current: { ...bundle.current, review_status: status },
    },
  };
}

function trackTask(seed: WorkItem, bucket: "task" | "background") {
  const box = { item: seed };
  vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
    if (workType === bucket) return [box.item];
    return [];
  });
  vi.mocked(getWorkItem).mockImplementation(async () => box.item);
  return box;
}

function renderTasks(path: string) {
  return renderWithRouter(
    <Routes>
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/tasks/:taskId" element={<TasksPage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

/** 按钮卸下的那一轮，绘制前焦点已经在目标上。useEffect 会先停在页面空白。 */
function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  taskPageLayoutFocus.notify = () => {
    if (!gone()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
}

describe("TasksPage", () => {
  beforeEach(() => {
    taskPageLayoutFocus.notify = null;
    vi.clearAllMocks();
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [sampleTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(sampleTask);
    vi.mocked(getWorkDelivery).mockResolvedValue(historyFull);
  });

  it("shows project-brief review metrics for the recent window", async () => {
    vi.mocked(getDeliveryMetrics).mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 2,
      accepted_tasks: 2,
      first_reviewed_tasks: 2,
      first_version_accepted_tasks: 1,
      first_version_acceptance_rate: 0.5,
      rework_count: 1,
      adopted_action_count: 1,
      average_review_latency_hours: 1.5,
      attribution: {
        approval_interventions: 2,
        recovery_interventions: 1,
        llm_cost: "unavailable",
        unattributed_project_brief_calls: 0,
        unattributed_project_brief_cost: 0,
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    renderTasks("/tasks");
    expect(await screen.findByText("近 30 日简报")).toBeInTheDocument();
    expect(screen.getByText("首版采纳 50%（1/2）")).toBeInTheDocument();
    expect(screen.getByText(/返工 1 · 已转任务 1 · 平均评审 1.5 小时/)).toBeInTheDocument();
    expect(screen.getByText("审批 2 · 恢复 1 · 窗口模型成本未分开计")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-metrics-works")).not.toBeInTheDocument();
  });

  it("shows attributed brief cost beside unattributed calls", async () => {
    vi.mocked(getDeliveryMetrics).mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 1,
      accepted_tasks: 1,
      first_reviewed_tasks: 1,
      first_version_accepted_tasks: 1,
      first_version_acceptance_rate: 1,
      rework_count: 0,
      adopted_action_count: 0,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: 0,
        recovery_interventions: 0,
        llm_cost: 0.0125,
        unattributed_project_brief_calls: 2,
        unattributed_project_brief_cost: 1.9,
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    renderTasks("/tasks");
    expect(
      await screen.findByText("审批 0 · 恢复 0 · 窗口模型成本 $0.0125 · 未归因 $1.9000（2 次）"),
    ).toBeInTheDocument();
  });

  it("shows unattributed brief dollars when attributable cost is zero", async () => {
    vi.mocked(getDeliveryMetrics).mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 1,
      accepted_tasks: 1,
      first_reviewed_tasks: 1,
      first_version_accepted_tasks: 1,
      first_version_acceptance_rate: 1,
      rework_count: 0,
      adopted_action_count: 0,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: 0,
        recovery_interventions: 0,
        llm_cost: 0,
        unattributed_project_brief_calls: 3,
        unattributed_project_brief_cost: 2.25,
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    renderTasks("/tasks");
    expect(
      await screen.findByText("审批 0 · 恢复 0 · 窗口模型成本 $0.0000 · 未归因 $2.2500（3 次）"),
    ).toBeInTheDocument();
  });

  it("links window briefs by work id and leaves a blank id as text", async () => {
    vi.mocked(getDeliveryMetrics).mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 3,
      accepted_tasks: 1,
      first_reviewed_tasks: 1,
      first_version_accepted_tasks: 1,
      first_version_acceptance_rate: 1,
      rework_count: 1,
      adopted_action_count: 1,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: 0,
        recovery_interventions: 0,
        llm_cost: 0.5,
        unattributed_project_brief_calls: 0,
        unattributed_project_brief_cost: 0,
      },
      capped: false,
      cap_limit: 5000,
      items: [
        {
          work_id: "brief/1",
          title: "项目 A",
          reviews: 1,
          accepted: true,
          first_review_accepted_v1: true,
          reworks: 0,
          adopted_actions: 0,
          average_review_latency_hours: null,
        },
        {
          work_id: "   ",
          title: "没有任务",
          reviews: 1,
          accepted: false,
          first_review_accepted_v1: false,
          reworks: 1,
          adopted_actions: 0,
          average_review_latency_hours: null,
        },
        {
          work_id: "brief_2",
          title: "  ",
          reviews: 1,
          accepted: false,
          first_review_accepted_v1: false,
          reworks: 0,
          adopted_actions: 1,
          average_review_latency_hours: 1,
        },
      ],
    });
    renderTasks("/tasks");

    const list = await screen.findByTestId("delivery-metrics-works");
    expect(within(list).getByRole("link", { name: "项目 A" })).toHaveAttribute(
      "href",
      "/tasks/brief%2F1",
    );
    expect(within(list).getByText("没有任务").closest("a")).toBeNull();
    expect(within(list).queryByRole("link", { name: "没有任务" })).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "项目简报" })).toHaveAttribute(
      "href",
      "/tasks/brief_2",
    );
    expect(screen.getByText("审批 0 · 恢复 0 · 窗口模型成本 $0.5000")).toBeInTheDocument();
  });

  it("renders empty tasks shell", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    const { container } = renderTasks("/tasks");
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("交办、交付与验收")).toBeInTheDocument();
    expect(container.querySelector(".page-shell .page-container")).toBeTruthy();
    expect(container.querySelector(".flex.min-h-0")).toBeNull();
  });

  it("keeps the list and detail placeholder in one page shell", async () => {
    renderTasks("/tasks");

    const row = await screen.findByRole("link", { name: /整理报告/ });
    expect(row).toHaveAttribute("href", "/tasks/task_1");
    expect(row).toHaveClass("focus-visible:ring-focus-ring");
    expect(row).not.toHaveAttribute("aria-current");
    const list = screen.getByRole("region", { name: "任务列表" });
    const detail = screen.getByRole("region", { name: "任务详情" });
    expect(list).not.toHaveClass("hidden");
    expect(detail).toHaveClass("hidden", "lg:block");
    expect(screen.getByRole("heading", { name: "任务" })).toBeInTheDocument();
    expect(screen.getByText("选择一个任务")).toBeInTheDocument();
  });

  it("opens the detail on narrow screens and keeps a way back to the list", async () => {
    renderTasks("/tasks/task_1");

    expect(await screen.findByText("最近一步输出（预览）")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "任务列表" })).toHaveClass("hidden", "lg:block");
    expect(screen.getByRole("region", { name: "任务详情" })).not.toHaveClass("hidden");
    const back = screen.getByRole("link", { name: "返回列表" });
    expect(back).toHaveAttribute("href", "/tasks");
    expect(back).toHaveClass("focus-visible:ring-focus-ring");
    expect(back.parentElement).toHaveClass("lg:hidden");
    expect(screen.getByRole("link", { name: /整理报告/ })).toHaveAttribute("aria-current", "page");
  });

  it("encodes a task id that contains a slash", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [{ ...sampleTask, id: "task/9", title: "斜杠任务" }];
      return [];
    });
    renderTasks("/tasks");

    expect(await screen.findByRole("link", { name: /斜杠任务/ })).toHaveAttribute(
      "href",
      "/tasks/task%2F9",
    );
  });

  it("shows previous_output and asks for plan confirmation before execute", async () => {
    renderTasks("/tasks/task_1");

    expect(await screen.findByText("最近一步输出（预览）")).toBeInTheDocument();
    expect(screen.getByText("wrote draft")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(await screen.findByText("确认执行计划")).toBeInTheDocument();
    expect(screen.getByText(/将从第 1 \/ 2 步开始执行/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(executeWorkItem).toHaveBeenCalledWith("task_1");
    });
  });

  it("shows the handler error already stored on the execution row", async () => {
    const failed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        steps: [{ tool: "write_file" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_err",
          status: "failed",
          dead_letter: true,
          retry_count: 3,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "Timeout after 30.0s",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [failed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(failed);
    renderTasks("/tasks/task_1");

    const log = await screen.findByRole("region", { name: "执行状态" });
    expect(within(log).getByText("Timeout after 30.0s")).toBeInTheDocument();
    expect(within(log).getByText(/on_execute_requested/)).toBeInTheDocument();
  });

  it("shows a stored failure reason beside the rerun hint", async () => {
    const failed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        steps: [{ tool: "write_file" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_hint",
          status: "failed",
          dead_letter: true,
          retry_count: 1,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "Timeout after 30.0s",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [failed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(failed);
    renderTasks("/tasks/task_1");

    const hint = await screen.findByText("上次执行已失败。可以重新执行。");
    const reason = screen.getByTestId("rerun-failure-reason");
    expect(reason).toHaveTextContent("Timeout after 30.0s");
    expect(hint.parentElement).toContainElement(reason);
    expect(screen.getByRole("region", { name: "执行状态" })).not.toContainElement(reason);
  });

  it("shows a rework failure reason above the existing delivery while the log stays collapsed", async () => {
    const rework: WorkItem = {
      ...briefTask,
      status: "failed",
      execution: {
        ...briefTask.execution!,
        handler_execution: {
          id: "wi_rework",
          status: "completed",
          dead_letter: false,
          retry_count: 0,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "tool step failed: disk full",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [rework];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(rework);
    renderTasks("/tasks/brief_1");

    const reason = await screen.findByTestId("rerun-failure-reason");
    expect(reason).toHaveTextContent("tool step failed: disk full");
    expect(screen.getByText("有进度风险")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新执行" })).toBeInTheDocument();
    const log = screen.getByRole("button", { name: /执行日志/ });
    expect(log).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "执行状态" })).not.toBeInTheDocument();

    fireEvent.click(log);
    const status = await screen.findByRole("region", { name: "执行状态" });
    expect(status).toHaveTextContent("tool step failed: disk full");
    expect(status).not.toContainElement(reason);
    expect(screen.getAllByText("tool step failed: disk full")).toHaveLength(2);
  });

  it("shows a running dead-letter reason beside the rerun hint", async () => {
    const stuck: WorkItem = {
      ...sampleTask,
      status: "running",
      execution: {
        steps: [{ tool: "write_file" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_stuck",
          status: "failed",
          dead_letter: true,
          retry_count: 2,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "interrupted",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [stuck];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(stuck);
    renderTasks("/tasks/task_1");

    const hint = await screen.findByText("上次执行已失败，任务仍显示为进行中。可以重新执行。");
    const reason = screen.getByTestId("rerun-failure-reason");
    expect(reason).toHaveTextContent("interrupted");
    expect(hint.parentElement).toContainElement(reason);
  });

  it("omits a blank failure reason next to the rerun hint", async () => {
    const failed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        ...sampleTask.execution!,
        handler_execution: {
          id: "wi_blank",
          status: "failed",
          dead_letter: false,
          retry_count: 0,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "   ",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [failed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(failed);
    renderTasks("/tasks/task_1");

    expect(await screen.findByText("上次执行已失败。可以重新执行。")).toBeInTheDocument();
    expect(screen.queryByTestId("rerun-failure-reason")).not.toBeInTheDocument();
  });

  it("does not surface a handler error on a completed delivery", async () => {
    const done: WorkItem = {
      ...briefTask,
      execution: {
        ...briefTask.execution!,
        handler_execution: {
          id: "wi_done",
          status: "completed",
          dead_letter: false,
          retry_count: 0,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "stale boom",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [done];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(done);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.queryByTestId("rerun-failure-reason")).not.toBeInTheDocument();
    expect(screen.queryByText("stale boom")).not.toBeInTheDocument();
  });

  it("shows a plan failure reason when the handler row itself completed", async () => {
    const failed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        steps: [{ tool: "read_file" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_plan",
          status: "completed",
          dead_letter: false,
          retry_count: 0,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
          error: "disk full",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [failed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(failed);
    renderTasks("/tasks/task_1");

    const log = await screen.findByRole("region", { name: "执行状态" });
    expect(within(log).getByText("disk full")).toBeInTheDocument();
    expect(within(log).getByText(/completed/)).toBeInTheDocument();
  });

  it("offers retry when a running task's handler has already failed", async () => {
    const stuck: WorkItem = {
      ...sampleTask,
      status: "running",
      execution: {
        steps: [{ tool: "write_file" }, { tool: "send_email" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_dead",
          status: "failed",
          dead_letter: true,
          retry_count: 2,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [stuck];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(stuck);
    renderTasks("/tasks/task_1");

    expect(await screen.findByText(/上次执行已失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新执行" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(executeWorkItem).toHaveBeenCalledWith("task_1");
    });
  });

  it("does not offer re-execute while the current attempt has no handler row", async () => {
    const running: WorkItem = {
      ...sampleTask,
      status: "running",
      execution: {
        steps: [{ tool: "write_file" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: null,
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [running];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(running);
    renderTasks("/tasks/task_1");

    expect(await screen.findByRole("heading", { name: "整理报告" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新执行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument();
    expect(screen.queryByText(/上次执行已失败/)).not.toBeInTheDocument();
  });

  it("labels a failed task that can run again as 重新执行", async () => {
    const closed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        steps: [{ tool: "write_file" }, { tool: "send_email" }],
        resume_from: 0,
        previous_output: {},
        handler_execution: {
          id: "wi_closed",
          status: "failed",
          dead_letter: true,
          retry_count: 2,
          handler_name: "on_execute_requested",
          started_at: "2026-08-06T00:00:00Z",
          completed_at: "2026-08-06T00:01:00Z",
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [closed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(closed);
    renderTasks("/tasks/task_1");

    expect(await screen.findByText("上次执行已失败。可以重新执行。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新执行" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(executeWorkItem).toHaveBeenCalledWith("task_1");
    });
  });

  it("keeps rerunnable failed tasks in the active group with a badge", async () => {
    const rerunnable: WorkItem = {
      ...sampleTask,
      id: "failed_rerun",
      title: "可重跑失败",
      status: "failed",
    };
    const noPlan: WorkItem = {
      ...sampleTask,
      id: "failed_done",
      title: "无法再执行",
      status: "failed",
      executable_plan: null,
    };
    const adopted: WorkItem = {
      ...sampleTask,
      id: "failed_adopted",
      title: "失败的简报待办",
      status: "failed",
      executable_plan: JSON.stringify({ kind: "adopted_suggestion", steps: [] }),
    };
    const done: WorkItem = {
      ...sampleTask,
      id: "done_1",
      title: "已完成任务",
      status: "completed",
    };
    const cancelled: WorkItem = {
      ...sampleTask,
      id: "cancelled_1",
      title: "已取消任务",
      status: "cancelled",
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [rerunnable, noPlan, adopted, done, cancelled, sampleTask];
      return [];
    });
    renderTasks("/tasks");

    const active = await screen.findByRole("region", { name: "进行中" });
    expect(within(active).getByText("可重跑失败")).toBeInTheDocument();
    expect(within(active).getByText("可重新执行")).toBeInTheDocument();
    expect(within(active).getByText("整理报告")).toBeInTheDocument();
    expect(within(active).queryByText("无法再执行")).not.toBeInTheDocument();
    expect(within(active).queryByText("失败的简报待办")).not.toBeInTheDocument();
    expect(within(active).queryByText("已完成任务")).not.toBeInTheDocument();
    expect(within(active).queryByText("已取消任务")).not.toBeInTheDocument();

    const history = screen.getByRole("region", { name: "历史" });
    expect(within(history).getByText("无法再执行")).toBeInTheDocument();
    expect(within(history).getByText("失败的简报待办")).toBeInTheDocument();
    expect(within(history).getByText("已完成任务")).toBeInTheDocument();
    expect(within(history).getByText("已取消任务")).toBeInTheDocument();
    expect(within(history).queryByText("可重新执行")).not.toBeInTheDocument();
    expect(within(history).queryByText("可重跑失败")).not.toBeInTheDocument();
  });

  it("labels a failed task without a handler row as 重新执行", async () => {
    const failed: WorkItem = {
      ...sampleTask,
      status: "failed",
      execution: {
        ...sampleTask.execution!,
        handler_execution: null,
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [failed];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(failed);
    renderTasks("/tasks/task_1");

    expect(await screen.findByRole("button", { name: "重新执行" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument();
  });

  it("creates a project brief from the form", async () => {
    vi.mocked(createProjectBrief).mockResolvedValue(briefTask);
    renderTasks("/tasks");
    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    fireEvent.change(screen.getByPlaceholderText("项目 A 简报"), {
      target: { value: "项目 A 简报" },
    });
    fireEvent.change(screen.getByPlaceholderText(/整理最近三天的邮件/), {
      target: { value: "整理最近三天邮件" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(createProjectBrief).toHaveBeenCalled();
    });
  });

  it("shows full delivery first and accepts the current version", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getByText(/完整正文超过预览长度/)).toBeInTheDocument();
    expect(screen.getByText("email:m1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "转为任务" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    await waitFor(() => {
      expect(adoptSuggestedAction).toHaveBeenCalledWith(
        "brief_1",
        "d2",
        0,
        expect.objectContaining({ idempotency_key: expect.any(String) }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "验收" }));
    expect(acceptWorkDelivery).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "验收交付" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认验收" }));
    await waitFor(() => {
      expect(acceptWorkDelivery).toHaveBeenCalledWith("brief_1", "d2", {
        idempotency_key: expect.any(String),
      });
    });
  });

  it("links a non-empty adopted task id and leaves a blank id as text", async () => {
    const adopted: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          suggested_actions: [
            { title: "核对排期", adopted_work_id: "task/2" },
            { title: "空白编号", adopted_work_id: "   " },
            { title: "还没转" },
          ],
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [adopted];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(adopted);
    renderTasks("/tasks/brief_1");

    const link = await screen.findByRole("link", { name: "已转为任务" });
    expect(link).toHaveAttribute("href", "/tasks/task%2F2");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
    const blank = screen.getByText("空白编号").closest("li");
    expect(blank).not.toBeNull();
    expect(
      within(blank as HTMLElement)
        .getByText("已转为任务")
        .closest("a"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "转为任务" })).toBeInTheDocument();
  });

  it("sends a trimmed acceptance note", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "验收" }));
    fireEvent.change(screen.getByPlaceholderText("例如：结论和来源都齐了。"), {
      target: { value: "  来源齐全\n可以归档  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认验收" }));
    await waitFor(() => {
      expect(acceptWorkDelivery).toHaveBeenCalledWith("brief_1", "d2", {
        reason: "来源齐全\n可以归档",
        idempotency_key: expect.any(String),
      });
    });
  });

  it("omits a whitespace-only acceptance note", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "验收" }));
    fireEvent.change(screen.getByPlaceholderText("例如：结论和来源都齐了。"), {
      target: { value: "   \n  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认验收" }));
    await waitFor(() => {
      expect(acceptWorkDelivery).toHaveBeenCalledWith("brief_1", "d2", {
        idempotency_key: expect.any(String),
      });
    });
  });

  it("shows this delivery's model cost, not another attempt", async () => {
    const priced: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          model_cost: { llm_cost: 1.25, recovery_interventions: 2 },
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [priced];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(priced);
    vi.mocked(getWorkDelivery).mockResolvedValue({
      ...historyFull,
      model_cost: { llm_cost: 0.2, recovery_interventions: 1 },
    });
    renderTasks("/tasks/brief_1");

    const currentCost = await screen.findByTestId("delivery-model-cost");
    expect(currentCost).toHaveTextContent("恢复 2 · 模型成本 $1.2500");
    expect(currentCost).not.toHaveTextContent("未归因");
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
    const historyCost = await screen.findByTestId("delivery-model-cost");
    expect(historyCost).toHaveTextContent("恢复 1 · 模型成本 $0.2000");
    expect(historyCost).not.toHaveTextContent("$1.2500");
    expect(historyCost).not.toHaveTextContent("未归因");
  });

  it("keeps a capped delivery model cost unavailable", async () => {
    const capped: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          model_cost: { llm_cost: "unavailable", recovery_interventions: "unavailable" },
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [capped];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(capped);
    renderTasks("/tasks/brief_1");

    const line = await screen.findByTestId("delivery-model-cost");
    expect(line).toHaveTextContent("恢复未分开计 · 模型成本未分开计");
    expect(line).not.toHaveTextContent("$0");
  });

  it("shows each listed version's model cost on the history row", async () => {
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          model_cost: { llm_cost: 1.25, recovery_interventions: 2 },
        },
        deliveries: [
          {
            ...historySummary,
            latest_decision: { decision: "changes_requested", reason: "第一版缺少风险" },
            model_cost: { llm_cost: "unavailable", recovery_interventions: "unavailable" },
          },
          {
            ...currentSummary,
            summary: "第二版摘要",
            checks: [{ criterion: "结论有来源", result: "pass" }],
            model_cost: { llm_cost: 0, recovery_interventions: 0 },
          },
          {
            delivery_id: "d3",
            version: 3,
            contract_version: 1,
            summary: "第三版摘要",
            limitations: [],
            suggested_actions: [],
            sources: [],
            checks: [],
            findings: [],
            schema_version: 1,
            qualified: true,
            review_status: "unreviewed",
          },
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    expect(
      await screen.findByRole("button", {
        name: "v1 · 已要求返工 · 恢复未分开计 · 模型成本未分开计 · 第一版缺少风险 · 第一版摘要",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "v2 · 待验收 · 恢复 0 · 模型成本 $0.0000 · 通过 1 · 第二版摘要",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v3 · 待验收 · 第三版摘要" })).toBeInTheDocument();
    const capped = screen.getByRole("button", { name: /v1 · 已要求返工/ });
    expect(capped).not.toHaveTextContent("$0");
    expect(screen.getByTestId("delivery-model-cost")).toHaveTextContent(
      "恢复 2 · 模型成本 $1.2500",
    );
  });

  it("loads full history version content by delivery id", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockResolvedValue(historyFull);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("完整正文超过预览长度".repeat(20))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
    await waitFor(() => {
      expect(getWorkDelivery).toHaveBeenCalledWith("brief_1", "d1");
    });
    expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
    expect(screen.queryByText("完整正文超过预览长度".repeat(20))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /v1 · 已要求返工/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /v2 · 待验收/ })).not.toHaveAttribute("aria-current");
  });

  it("retries a failed history load from the error and the same row", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockRejectedValueOnce(new ApiError("历史版本暂时读不到", 503));
    renderTasks("/tasks/brief_1");

    const current = await screen.findByRole("button", { name: /v2 · 待验收/ });
    expect(current).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
    const error = await screen.findByTestId("history-load-error");
    expect(error).toHaveTextContent("历史版本暂时读不到");
    expect(screen.getByRole("button", { name: /v1 · 已要求返工/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByText("完整正文超过预览长度".repeat(20))).not.toBeInTheDocument();

    vi.mocked(getWorkDelivery).mockRejectedValueOnce(new Error("still down"));
    fireEvent.click(within(error).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(getWorkDelivery).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId("history-load-error")).toHaveTextContent("加载历史版本失败");
    });

    vi.mocked(getWorkDelivery).mockResolvedValueOnce(historyFull);
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
    expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
    expect(screen.queryByTestId("history-load-error")).not.toBeInTheDocument();
    expect(getWorkDelivery).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
    expect(getWorkDelivery).toHaveBeenCalledTimes(3);
  });

  it("shows the history spinner in the delivery slot while the version list stays", async () => {
    let release: ((row: WorkDelivery) => void) | undefined;
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderTasks("/tasks/brief_1");

    const row = await screen.findByRole("button", { name: /v1 · 已要求返工/ });
    fireEvent.click(row);
    const status = await screen.findByTestId("history-load-status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("加载历史版本全文…");
    expect(screen.queryByText("完整正文超过预览长度".repeat(20))).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("history-load-error")).not.toBeInTheDocument();

    row.focus();
    release?.(historyFull);
    expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
    expect(screen.queryByTestId("history-load-status")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it("focuses history retry before paint when the version fails", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockRejectedValueOnce(new ApiError("历史版本暂时读不到", 503));
    renderTasks("/tasks/brief_1");

    const row = await screen.findByRole("button", { name: /v1 · 已要求返工/ });
    row.focus();
    const focusWhenShown = captureFocusWhenGone(() => {
      const button = screen.queryByRole("button", { name: "重试" });
      return button instanceof HTMLButtonElement && !button.hasAttribute("aria-busy");
    });
    fireEvent.click(row);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy"));
    expect(retry).toHaveFocus();
    expect(focusWhenShown.read()).toBe(retry);
    expect(focusWhenShown.read()).not.toBe(document.body);
    expect(focusWhenShown.read()).not.toBe(row);
  });

  it("does not pull history retry focus when an open dialog already has it", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockRejectedValueOnce(new ApiError("历史版本暂时读不到", 503));
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: /v1 · 已要求返工/ }));
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    const focusWhenOpen = captureFocusWhenGone(
      () => screen.queryByRole("dialog", { name: "新建项目资料简报" }) !== null,
    );
    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目资料简报" });
    expect(dialog).toHaveFocus();
    expect(focusWhenOpen.read()).toBe(dialog);
    expect(focusWhenOpen.read()).not.toBe(retry);
    expect(focusWhenOpen.read()).not.toBe(document.body);
  });

  it("keeps keyboard focus on history retry until the reread finishes", async () => {
    let release: ((row: WorkDelivery) => void) | undefined;
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery)
      .mockRejectedValueOnce(new ApiError("历史版本暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: /v1 · 已要求返工/ }));
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(screen.queryByTestId("history-load-status")).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("history-load-error")).toHaveTextContent("历史版本暂时读不到");

    const focusWhenShown = captureFocusWhenGone(
      () => screen.queryByText("历史版本完整正文甲") !== null,
    );
    release?.(historyFull);
    expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
    expect(screen.queryByTestId("history-load-error")).not.toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: /交付 v1/ });
    expect(heading).toHaveFocus();
    expect(focusWhenShown.read()).toBe(heading);
    expect(focusWhenShown.read()).not.toBe(document.body);
  });

  it("says there is only one version without listing a history row", async () => {
    const only: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "unreviewed",
        current: { ...currentDelivery, content: "   " },
        deliveries: [{ ...currentSummary, content: "   " }],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [only];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(only);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByTestId("delivery-single-version")).toHaveTextContent(
      "目前只有这一版。",
    );
    expect(screen.queryByRole("heading", { name: "版本历史" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /v2 · 待验收/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("delivery-body")).toHaveTextContent("这一版没有正文");
    expect(screen.queryByText("正在加载完整正文")).not.toBeInTheDocument();
  });

  it("says a brief has no version history when the list is empty", async () => {
    const empty: WorkItem = {
      ...briefTask,
      status: "pending",
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: null,
        current: null,
        deliveries: [],
      },
    };
    const plain: WorkItem = {
      ...sampleTask,
      delivery_bundle: {
        work_id: "task_1",
        current_review_status: null,
        current: null,
        deliveries: [],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [empty, plain];
      return [];
    });
    vi.mocked(getWorkItem).mockImplementation(async (id: string) => {
      if (id === "task_1") return plain;
      return empty;
    });
    renderTasks("/tasks/brief_1");

    expect(await screen.findByTestId("delivery-version-empty")).toHaveTextContent(
      "还没有版本历史。",
    );
    expect(screen.getByText("还没有交付结果。确认资料范围后执行任务。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "版本历史" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("delivery-single-version")).not.toBeInTheDocument();
  });

  it("does not announce empty version history on a task that is not a brief", async () => {
    const plain: WorkItem = {
      ...sampleTask,
      delivery_bundle: {
        work_id: "task_1",
        current_review_status: null,
        current: null,
        deliveries: [],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [plain];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(plain);
    renderTasks("/tasks/task_1");

    expect(await screen.findByRole("heading", { name: "整理报告" })).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-version-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delivery-single-version")).not.toBeInTheDocument();
  });

  it("moves keyboard focus across version rows without loading them", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    const current = await screen.findByRole("button", { name: /v2 · 待验收/ });
    const previous = screen.getByRole("button", { name: /v1 · 已要求返工/ });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(previous).toHaveAttribute("tabindex", "-1");

    current.focus();
    fireEvent.keyDown(current, { key: "ArrowUp" });
    expect(previous).toHaveFocus();
    expect(previous).toHaveAttribute("tabindex", "0");
    expect(current).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(previous, { key: "ArrowDown" });
    expect(current).toHaveFocus();
    fireEvent.keyDown(current, { key: "Home" });
    expect(previous).toHaveFocus();
    fireEvent.keyDown(previous, { key: "End" });
    expect(current).toHaveFocus();
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(current).toHaveFocus();
    expect(getWorkDelivery).not.toHaveBeenCalled();

    fireEvent.click(previous);
    expect(previous).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(getWorkDelivery).toHaveBeenCalledWith("brief_1", "d1"));
  });

  it("scrolls the delivery into view when switching versions and keeps row focus", async () => {
    let release: ((row: WorkDelivery) => void) | undefined;
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getWorkDelivery).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const scrolled: Array<{ el: HTMLElement; arg?: ScrollIntoViewOptions }> = [];
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      scrolled.push({ el: this, arg: typeof arg === "object" ? arg : undefined });
    };
    const slotScrolls = () =>
      scrolled.filter((entry) => entry.el.getAttribute("data-testid") === "delivery-slot");

    try {
      renderTasks("/tasks/brief_1");
      const current = await screen.findByRole("button", { name: /v2 · 待验收/ });
      const previous = screen.getByRole("button", { name: /v1 · 已要求返工/ });
      expect(slotScrolls()).toEqual([]);

      previous.focus();
      fireEvent.click(previous);
      expect(await screen.findByTestId("history-load-status")).toBeInTheDocument();
      expect(slotScrolls()).toEqual([
        { el: screen.getByTestId("delivery-slot"), arg: { block: "start", inline: "nearest" } },
      ]);
      expect(previous).toHaveFocus();
      expect(
        screen.queryByText("还没有交付结果。确认资料范围后执行任务。"),
      ).not.toBeInTheDocument();

      release?.(historyFull);
      expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
      expect(slotScrolls()).toHaveLength(2);
      expect(slotScrolls()[1]).toEqual({
        el: screen.getByTestId("delivery-slot"),
        arg: { block: "start", inline: "nearest" },
      });
      expect(previous).toHaveFocus();

      fireEvent.click(current);
      expect(screen.getByText("完整正文超过预览长度".repeat(20))).toBeInTheDocument();
      expect(slotScrolls()).toHaveLength(3);
      expect(previous).toHaveFocus();
      expect(screen.getByRole("heading", { name: /交付 v2/ })).not.toHaveFocus();
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  });

  it("does not scroll when leaving a task that had another version open", async () => {
    const plain: WorkItem = {
      ...sampleTask,
      delivery_bundle: {
        work_id: "task_1",
        current_review_status: null,
        current: null,
        deliveries: [],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask, plain];
      return [];
    });
    vi.mocked(getWorkItem).mockImplementation(async (id: string) => {
      if (id === "task_1") return plain;
      return briefTask;
    });
    vi.mocked(getWorkDelivery).mockResolvedValue(historyFull);
    const scrolled: HTMLElement[] = [];
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };

    try {
      renderTasks("/tasks/brief_1");
      fireEvent.click(await screen.findByRole("button", { name: /v1 · 已要求返工/ }));
      expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
      const beforeLeave = scrolled.filter(
        (el) => el.getAttribute("data-testid") === "delivery-slot",
      ).length;
      expect(beforeLeave).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("link", { name: /整理报告/ }));
      expect(await screen.findByRole("heading", { name: "整理报告" })).toBeInTheDocument();
      expect(screen.queryByText("历史版本完整正文甲")).not.toBeInTheDocument();
      expect(
        scrolled.filter((el) => el.getAttribute("data-testid") === "delivery-slot"),
      ).toHaveLength(beforeLeave);
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  });

  it("shows the stored rework reason on the current delivery", async () => {
    const reason = "需要补上风险，并给每条结论带来源";
    const reworked: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "changes_requested",
        current: {
          ...currentDelivery,
          review_status: "changes_requested",
          latest_decision: { decision: "changes_requested", reason },
        },
        deliveries: [currentSummary],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [reworked];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(reworked);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getAllByText("已要求返工").length).toBeGreaterThan(0);
    expect(screen.getByTestId("rework-reason")).toHaveTextContent(`返工理由：${reason}`);
  });

  it("does not present a withdrawn rework as in progress", async () => {
    const reason = "需要补风险";
    const withdrawn: WorkItem = {
      ...briefTask,
      status: "completed",
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "unreviewed",
        current: {
          ...currentDelivery,
          review_status: "unreviewed",
          latest_decision: { decision: "changes_requested", reason },
        },
        deliveries: [
          {
            ...currentSummary,
            review_status: "unreviewed",
            latest_decision: { decision: "changes_requested", reason },
          },
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [withdrawn];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(withdrawn);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getAllByText("待验收").length).toBeGreaterThan(0);
    expect(screen.queryByText("已要求返工")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rework-reason")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验收" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返工" })).toBeInTheDocument();
  });

  it("shows a historical version's rework reason", async () => {
    const reason = "第一版缺少风险";
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        deliveries: [
          {
            ...historySummary,
            latest_decision: { decision: "changes_requested", reason: `  ${reason}\n` },
          },
          currentSummary,
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    vi.mocked(getWorkDelivery).mockResolvedValue({
      ...historyFull,
      latest_decision: { decision: "changes_requested", reason },
    });
    renderTasks("/tasks/brief_1");

    const historyButton = await screen.findByRole("button", {
      name: new RegExp(`v1 · 已要求返工 · ${reason}`),
    });
    fireEvent.click(historyButton);
    expect(await screen.findByTestId("rework-reason")).toHaveTextContent(`返工理由：${reason}`);
  });

  it("omits a blank rework reason", async () => {
    const reworked: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "changes_requested",
        current: {
          ...currentDelivery,
          review_status: "changes_requested",
          latest_decision: { decision: "changes_requested", reason: "   " },
        },
        deliveries: [currentSummary],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [reworked];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(reworked);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getAllByText("已要求返工").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("rework-reason")).not.toBeInTheDocument();
  });

  it("shows the stored accept reason on the current delivery", async () => {
    const reason = "结论和来源都齐了，可以归档";
    const accepted: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "accepted",
        current: {
          ...currentDelivery,
          review_status: "accepted",
          latest_decision: { decision: "accepted", reason },
        },
        deliveries: [currentSummary],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [accepted];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(accepted);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getAllByText("已验收").length).toBeGreaterThan(0);
    expect(screen.getByTestId("accept-reason")).toHaveTextContent(`验收说明：${reason}`);
    expect(screen.queryByTestId("rework-reason")).not.toBeInTheDocument();
  });

  it("shows a historical version's accept reason", async () => {
    const reason = "第一版可以归档";
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        deliveries: [
          {
            ...historySummary,
            review_status: "accepted",
            latest_decision: { decision: "accepted", reason: `  ${reason}\n` },
          },
          currentSummary,
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    vi.mocked(getWorkDelivery).mockResolvedValue({
      ...historyFull,
      review_status: "accepted",
      latest_decision: { decision: "accepted", reason },
    });
    renderTasks("/tasks/brief_1");

    const historyButton = await screen.findByRole("button", {
      name: `v1 · 已验收 · ${reason} · 第一版摘要`,
    });
    fireEvent.click(historyButton);
    expect(await screen.findByTestId("accept-reason")).toHaveTextContent(`验收说明：${reason}`);
  });

  it("omits a blank accept reason", async () => {
    const accepted: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        work_id: "brief_1",
        current_review_status: "accepted",
        current: {
          ...currentDelivery,
          review_status: "accepted",
          latest_decision: { decision: "accepted", reason: "   " },
        },
        deliveries: [currentSummary],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [accepted];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(accepted);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.getAllByText("已验收").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("accept-reason")).not.toBeInTheDocument();
  });

  it("shows structured changes against the previous delivery", async () => {
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          changes_from_previous: {
            previous_delivery_id: "d1",
            previous_version: 1,
            summary_changed: true,
            content_changed: true,
            findings_added: [{ text: "排期推迟", kind: "risk", source_ids: ["email:m1"] }],
            findings_removed: [{ text: "进度正常", kind: "change", source_ids: [] }],
            findings_changed: [
              {
                text: "范围变化",
                kind: "risk",
                source_ids: ["file:1"],
                previous_kind: "change",
                previous_source_ids: ["email:m1"],
              },
            ],
            sources_added: [{ id: "email:m1", title: "延期邮件" }],
            sources_removed: [{ id: "file:old", title: "旧纪要" }],
            sources_changed: [],
            limitations_added: ["仅覆盖最近三天"],
            limitations_removed: [],
            actions_added: [],
            actions_removed: [{ title: "旧待办" }],
            actions_changed: [
              {
                title: "核对排期",
                reason: "新理由",
                previous_reason: "旧理由",
              },
            ],
          },
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    const panel = await screen.findByTestId("delivery-version-diff");
    expect(panel).toHaveClass("bg-surface-sunken", "break-words");
    expect(panel).toHaveTextContent("相对 v1");
    expect(panel).toHaveTextContent("新增结论：[风险] 排期推迟（email:m1）");
    expect(panel).toHaveTextContent("去掉的结论：[变化] 进度正常");
    expect(panel).toHaveTextContent("改写的结论：范围变化，变化 → 风险，来源 email:m1 → file:1");
    expect(panel).toHaveTextContent("新增来源：email:m1 延期邮件");
    expect(panel).toHaveTextContent("去掉的来源：file:old 旧纪要");
    expect(panel).toHaveTextContent("新增限制：仅覆盖最近三天");
    expect(panel).toHaveTextContent("去掉的待办：旧待办");
    expect(panel).toHaveTextContent("待办有更新：核对排期，理由 旧理由 → 新理由");
    expect(panel).toHaveTextContent("摘要已更新");
    expect(panel).not.toHaveTextContent("正文已更新");
  });

  it("says the delivery matches the previous version when nothing changed", async () => {
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          changes_from_previous: {
            previous_delivery_id: "d1",
            previous_version: 1,
            summary_changed: false,
            content_changed: false,
            findings_added: [],
            findings_removed: [],
            findings_changed: [],
            sources_added: [],
            sources_removed: [],
            sources_changed: [],
            limitations_added: [],
            limitations_removed: [],
            actions_added: [],
            actions_removed: [],
            actions_changed: [],
          },
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByTestId("delivery-version-diff")).toHaveTextContent("与上一版相同");
  });

  it("shows a body-only change without repeating structured lines", async () => {
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          changes_from_previous: {
            previous_delivery_id: "d1",
            previous_version: 1,
            summary_changed: false,
            content_changed: true,
            findings_added: [],
            findings_removed: [],
            findings_changed: [],
            sources_added: [],
            sources_removed: [],
            sources_changed: [],
            limitations_added: [],
            limitations_removed: [],
            actions_added: [],
            actions_removed: [],
            actions_changed: [],
          },
        },
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    const panel = await screen.findByTestId("delivery-version-diff");
    expect(panel).toHaveTextContent("正文已更新");
    expect(panel).not.toHaveTextContent("与上一版相同");
  });

  it("shows stored acceptance checks on the current delivery and version list", async () => {
    const checks = [
      {
        criterion: "每条关键结论附来源",
        result: "fail" as const,
        programmatic: true,
        detail: "2 findings lack citations",
      },
      {
        criterion: "不编造来源",
        result: "pass" as const,
        programmatic: true,
        detail: "all citations in allowed source set",
      },
      {
        criterion: "语气必须让老板满意",
        result: "needs_review" as const,
        programmatic: false,
        detail: "requires human judgment",
      },
      { criterion: "  ", result: "  ", detail: "   " },
    ];
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: { ...currentDelivery, checks },
        deliveries: [historySummary, { ...currentSummary, checks }],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    const panel = await screen.findByTestId("delivery-checks");
    expect(panel).toHaveTextContent("未通过 · 每条关键结论附来源 · 2 条结论缺少来源");
    expect(panel).toHaveTextContent("通过 · 不编造来源 · 引用都在允许的来源内");
    expect(panel).toHaveTextContent("待判断 · 语气必须让老板满意 · 需要人工判断");
    expect(
      screen.getByRole("button", {
        name: "v2 · 待验收 · 通过 1 · 未通过 1（每条关键结论附来源） · 待判断 1（语气必须让老板满意） · 有进度风险",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "v1 · 已要求返工 · 第一版摘要" }),
    ).toBeInTheDocument();
  });

  it("shows stored checks for a historical version", async () => {
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: {
          ...currentDelivery,
          checks: [{ criterion: "当前版要求", result: "pass", detail: "0 missing citations" }],
        },
        deliveries: [
          {
            ...historySummary,
            checks: [
              { criterion: "不编造来源", result: "pass", detail: "0 missing citations" },
              {
                criterion: "每条关键结论附来源",
                result: "fail",
                detail: "1 findings lack citations",
              },
            ],
          },
          {
            ...currentSummary,
            checks: [{ criterion: "当前版要求", result: "pass", detail: "0 missing citations" }],
          },
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    vi.mocked(getWorkDelivery).mockResolvedValue({
      ...historyFull,
      checks: [
        {
          criterion: "资料不足时明确说明",
          result: "needs_review",
          detail: "no sources in this run",
        },
        { criterion: "额外门槛", result: "blocked", detail: "仍需确认" },
      ],
    });
    renderTasks("/tasks/brief_1");

    expect(await screen.findByTestId("delivery-checks")).toHaveTextContent(
      "通过 · 当前版要求 · 引用完整",
    );
    const historyButton = screen.getByRole("button", {
      name: "v1 · 已要求返工 · 通过 1 · 未通过 1（每条关键结论附来源） · 第一版摘要",
    });
    fireEvent.click(historyButton);
    const panel = await screen.findByTestId("delivery-checks");
    expect(panel).toHaveTextContent("待判断 · 资料不足时明确说明 · 本次没有来源");
    expect(panel).toHaveTextContent("blocked · 额外门槛 · 仍需确认");
    expect(panel).not.toHaveTextContent("当前版要求");
    expect(
      screen.getByRole("button", { name: "v2 · 待验收 · 通过 1 · 有进度风险" }),
    ).toBeInTheDocument();
  });

  it("omits blank acceptance checks", async () => {
    const blank = [{ criterion: "  ", result: " ", detail: "\n" }];
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: { ...currentDelivery, checks: blank },
        deliveries: [
          { ...historySummary, checks: blank },
          { ...currentSummary, checks: blank },
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("有进度风险")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-checks")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "v1 · 已要求返工 · 第一版摘要" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v2 · 待验收 · 有进度风险" })).toBeInTheDocument();
  });

  it("reruns a completed brief on the same task", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    expect(await screen.findByTestId("rerun-same-brief-hint")).toHaveTextContent("相对上一版");
    expect(screen.queryByRole("button", { name: "重新执行" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再次运行" }));
    expect(await screen.findByText(/不另建任务，也不记成返工/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认再次运行" }));
    await waitFor(() => expect(rerunProjectBrief).toHaveBeenCalledWith("brief_1"));
    expect(executeWorkItem).not.toHaveBeenCalled();
    expect(reworkWorkDelivery).not.toHaveBeenCalled();
  });

  it("schedules a repeat of the same brief", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "定时再次运行" }));
    expect(await screen.findByText(/不会为这次触发另建交付/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("小时"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "确认定时" }));
    await waitFor(() =>
      expect(scheduleBriefRepeat).toHaveBeenCalledWith("brief_1", { hours: 2, minutes: 0 }),
    );
    expect(await screen.findByTestId("scheduled-repeat-note")).toHaveTextContent(
      "2026-09-24T08:00:00Z",
    );
    expect(rerunProjectBrief).not.toHaveBeenCalled();
    expect(screen.getByTestId("scheduled-repeat-note")).toHaveTextContent("这一份任务");
  });

  it("scrolls cited source ids to the source row and opens email detail", async () => {
    const cited = {
      ...currentDelivery,
      findings: [
        {
          text: "排期推迟",
          kind: "risk",
          source_ids: ["email:m1", "file:abc", "email:missing"],
        },
      ],
      suggested_actions: [{ title: "核对排期", reason: "邮件提到延期", source_ids: ["email:m1"] }],
      sources: [
        { id: "email:m1", type: "email", title: "延期邮件", locator: "a@example.com" },
        { id: "email:m10", type: "email", title: "另一封", locator: "b@example.com" },
        { id: "file:abc", type: "file", title: "纪要", locator: "C:\\notes\\a.md" },
      ],
    };
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: cited,
        deliveries: [historySummary, { ...currentSummary, ...cited }],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    vi.mocked(getInboxEmailDetail).mockResolvedValue({
      id: "m1",
      sender: "a@example.com",
      subject: "延期邮件全文",
      preview: "延期",
      received_at: "2026-09-20T00:00:00Z",
      category: "actionable",
      importance: 0.5,
      reason: "需要跟进",
      notified: 0,
      digested: 0,
      status: "pending",
      created_at: "2026-09-20T00:00:00Z",
    });
    const scrolled: HTMLElement[] = [];
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };
    try {
      renderTasks("/tasks/brief_1");

      const findings = await screen.findByTestId("delivery-findings");
      const fileRow = screen.getByTestId("delivery-source-file:abc");
      const emailRow = screen.getByTestId("delivery-source-email:m1");
      expect(fileRow).toHaveAttribute("data-delivery-source-id", "file:abc");
      expect(fileRow).toHaveTextContent("C:\\notes\\a.md");
      expect(within(fileRow).queryByRole("button")).not.toBeInTheDocument();
      expect(
        within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }),
      ).toBeInTheDocument();

      fireEvent.click(within(findings).getByRole("button", { name: "来源 file:abc" }));
      expect(scrolled).toEqual([fileRow]);
      expect(getInboxEmailDetail).not.toHaveBeenCalled();

      scrolled.length = 0;
      fireEvent.click(within(findings).getByRole("button", { name: "来源 email:missing" }));
      expect(scrolled).toEqual([]);
      expect(getInboxEmailDetail).not.toHaveBeenCalled();

      const suggestions = screen.getByRole("heading", { name: "建议待办" }).closest("div");
      expect(suggestions).toBeTruthy();
      fireEvent.click(
        within(suggestions as HTMLElement).getByRole("button", { name: "来源 email:m1" }),
      );
      expect(scrolled).toEqual([emailRow]);
      expect(scrolled).not.toContain(screen.getByTestId("delivery-source-email:m10"));
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("m1"));
      expect(await screen.findByRole("heading", { name: "延期邮件全文" })).toBeInTheDocument();

      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledTimes(2));
      expect(getInboxEmailDetail).toHaveBeenNthCalledWith(2, "m1");
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  });

  it("navigates current, previous, removed, and body source ids", async () => {
    const cited = {
      ...currentDelivery,
      content:
        "正文保留 `email:m1` 与 `file:abc`，还有 `email:m10`。路径 `C:\\notes\\a.md`，未知 `email:missing`",
      findings: [],
      suggested_actions: [],
      sources: [
        { id: "email:m1", type: "email", title: "延期邮件", locator: "a@example.com" },
        { id: "email:m10", type: "email", title: "另一封", locator: "b@example.com" },
        { id: "file:abc", type: "file", title: "纪要", locator: "C:\\notes\\a.md" },
      ],
      changes_from_previous: {
        previous_delivery_id: "d1",
        previous_version: 1,
        summary_changed: false,
        content_changed: true,
        findings_added: [{ text: "排期推迟", kind: "risk", source_ids: ["email:m1"] }],
        findings_removed: [
          {
            text: "进度正常",
            kind: "change",
            source_ids: ["email:old", "email:m1", "file:old"],
          },
        ],
        findings_changed: [
          {
            text: "范围变化",
            kind: "risk",
            source_ids: ["file:abc"],
            previous_kind: "change",
            previous_source_ids: ["email:m1", "file:gone"],
          },
        ],
        sources_added: [
          { id: "file:abc", type: "file", title: "纪要", locator: "C:\\notes\\a.md" },
        ],
        sources_removed: [
          { id: "file:old", type: "file", title: "旧纪要", locator: "C:\\notes\\old.md" },
          { id: "email:dropped", type: "email", title: "已删邮件" },
        ],
        sources_changed: [],
        limitations_added: [],
        limitations_removed: [],
        actions_added: [{ title: "核对邮件", source_ids: ["email:m1", "file:abc"] }],
        actions_removed: [{ title: "旧待办", source_ids: ["email:old", "file:old"] }],
        actions_changed: [
          {
            title: "核对排期",
            source_ids: ["email:m1"],
            previous_source_ids: ["email:gone"],
          },
        ],
      },
    };
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: cited,
        deliveries: [
          {
            ...historySummary,
            sources: [
              { id: "email:old", type: "email", title: "旧邮件" },
              { id: "file:old", type: "file", title: "旧纪要", locator: "C:\\notes\\old.md" },
              { id: "file:gone", type: "file", title: "不见了", locator: "D:\\x.txt" },
            ],
          },
          { ...currentSummary, ...cited },
        ],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    vi.mocked(getInboxEmailDetail).mockResolvedValue({
      id: "m1",
      sender: "a@example.com",
      subject: "延期邮件全文",
      preview: "延期",
      received_at: "2026-09-20T00:00:00Z",
      category: "actionable",
      importance: 0.5,
      reason: "需要跟进",
      notified: 0,
      digested: 0,
      status: "pending",
      created_at: "2026-09-20T00:00:00Z",
    });
    const scrolled: HTMLElement[] = [];
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };
    try {
      renderTasks("/tasks/brief_1");

      const panel = await screen.findByTestId("delivery-version-diff");
      const fileRow = screen.getByTestId("delivery-source-file:abc");
      const emailRow = screen.getByTestId("delivery-source-email:m1");
      expect(within(fileRow).queryByRole("button")).not.toBeInTheDocument();

      const added = within(panel)
        .getByText(/新增结论/)
        .closest("li");
      expect(added).toHaveTextContent("新增结论：[风险] 排期推迟（email:m1）");
      const changed = within(panel)
        .getByText(/改写的结论/)
        .closest("li");
      expect(changed).toHaveTextContent(
        "改写的结论：范围变化，变化 → 风险，来源 email:m1、file:gone → file:abc",
      );
      expect(
        within(changed as HTMLElement).getByRole("button", { name: "来源 email:m1" }),
      ).toBeInTheDocument();
      expect(
        within(changed as HTMLElement).queryByRole("button", { name: "来源 file:gone" }),
      ).not.toBeInTheDocument();
      const removed = within(panel)
        .getByText(/去掉的结论/)
        .closest("li");
      expect(removed).toHaveTextContent(
        "去掉的结论：[变化] 进度正常（email:old、email:m1、file:old）",
      );
      expect(
        within(removed as HTMLElement).queryByRole("button", { name: "来源 file:old" }),
      ).not.toBeInTheDocument();
      const removedFile = within(panel).getByText("去掉的来源：file:old 旧纪要").closest("li");
      expect(within(removedFile as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
      expect(removedFile).not.toHaveTextContent("C:\\notes\\old.md");
      const removedEmail = within(panel)
        .getByRole("button", { name: "来源 email:dropped" })
        .closest("li");
      expect(removedEmail).toHaveTextContent("去掉的来源：email:dropped 已删邮件");
      const addedSource = within(panel).getByText("新增来源：file:abc 纪要").closest("li");
      expect(within(addedSource as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
      const addedAction = within(panel)
        .getByText(/新增待办：核对邮件/)
        .closest("li");
      expect(addedAction).toHaveTextContent("新增待办：核对邮件（email:m1、file:abc）");
      const removedAction = within(panel)
        .getByText(/去掉的待办：旧待办/)
        .closest("li");
      expect(removedAction).toHaveTextContent("去掉的待办：旧待办（email:old、file:old）");
      expect(
        within(removedAction as HTMLElement).queryByRole("button", { name: "来源 file:old" }),
      ).not.toBeInTheDocument();
      const changedAction = within(panel)
        .getByText(/待办有更新/)
        .closest("li");
      expect(changedAction).toHaveTextContent("待办有更新：核对排期，来源 email:gone → email:m1");
      expect(
        within(changedAction as HTMLElement).queryByRole("button", { name: "来源 email:gone" }),
      ).not.toBeInTheDocument();

      const body = screen.getByTestId("delivery-body");
      expect(body.tagName).toBe("PRE");
      expect(body).toHaveTextContent("`C:\\notes\\a.md`");
      expect(body).toHaveTextContent("`email:missing`");
      expect(
        within(body).queryByRole("button", { name: "来源 email:missing" }),
      ).not.toBeInTheDocument();
      expect(within(body).queryByRole("button", { name: /notes/ })).not.toBeInTheDocument();

      fireEvent.click(
        within(changed as HTMLElement).getByRole("button", { name: "来源 email:m1" }),
      );
      expect(scrolled).toEqual([emailRow]);
      expect(scrolled).not.toContain(screen.getByTestId("delivery-source-email:m10"));
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("m1"));

      scrolled.length = 0;
      fireEvent.click(
        within(removed as HTMLElement).getByRole("button", { name: "来源 email:old" }),
      );
      expect(scrolled).toEqual([]);
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("old"));

      fireEvent.click(
        within(removedEmail as HTMLElement).getByRole("button", { name: "来源 email:dropped" }),
      );
      expect(scrolled).toEqual([]);
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("dropped"));

      fireEvent.click(
        within(changed as HTMLElement).getByRole("button", { name: "来源 file:abc" }),
      );
      expect(scrolled).toEqual([fileRow]);
      expect(getInboxEmailDetail).not.toHaveBeenCalledWith("abc");

      scrolled.length = 0;
      fireEvent.click(within(body).getByRole("button", { name: "来源 file:abc" }));
      expect(scrolled).toEqual([fileRow]);
      expect(getInboxEmailDetail).not.toHaveBeenCalledWith("abc");

      scrolled.length = 0;
      fireEvent.click(within(body).getByRole("button", { name: "来源 email:m10" }));
      expect(scrolled).toEqual([screen.getByTestId("delivery-source-email:m10")]);
      expect(scrolled).not.toContain(emailRow);
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("m10"));

      fireEvent.click(within(added as HTMLElement).getByRole("button", { name: "来源 email:m1" }));
      expect(scrolled).toContain(emailRow);
      fireEvent.click(
        within(removedAction as HTMLElement).getByRole("button", { name: "来源 email:old" }),
      );
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledWith("old"));
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  });

  function openedMail(id: string, subject: string) {
    return {
      id,
      sender: "a@example.com",
      subject,
      preview: "延期",
      received_at: "2026-09-20T00:00:00Z",
      category: "actionable",
      importance: 0.5,
      reason: "需要跟进",
      notified: 0,
      digested: 0,
      status: "pending" as const,
      created_at: "2026-09-20T00:00:00Z",
    };
  }

  async function withMailBrief(run: () => Promise<void>) {
    const cited: WorkDelivery = {
      ...currentDelivery,
      findings: [{ text: "排期推迟", kind: "risk", source_ids: ["file:abc"] }],
      sources: [
        { id: "email:m1", type: "email", title: "延期邮件" },
        { id: "email:m10", type: "email", title: "另一封" },
        { id: "file:abc", type: "file", title: "纪要" },
      ],
    };
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: cited,
        deliveries: [historySummary, { ...currentSummary, ...cited }],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    try {
      renderTasks("/tasks/brief_1");
      await run();
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  }

  it("keeps the delivery and a retry when opening a cited mail fails", async () => {
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new ApiError("邮件暂时读不到", 503));
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));

      const alert = await screen.findByTestId("task-mail-load-error");
      expect(alert).toHaveTextContent("邮件暂时读不到");
      expect(addError).toHaveBeenCalledWith("邮件暂时读不到", "任务");
      expect(screen.getByText("有进度风险")).toBeInTheDocument();
      expect(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" })).toBeEnabled();
      expect(
        within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }),
      ).not.toHaveAttribute("aria-busy");
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
      expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
      expect(screen.queryByText("延期邮件全文")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus(),
      );
    });
  });

  it("holds the cited-mail failure while that reread is in flight", async () => {
    vi.mocked(getInboxEmailDetail).mockRejectedValueOnce(new ApiError("邮件暂时读不到", 503));
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));
      const retry = await screen.findByRole("button", { name: "重试" });
      await waitFor(() => expect(retry).toHaveFocus());

      let release: ((row: ReturnType<typeof openedMail>) => void) | undefined;
      vi.mocked(getInboxEmailDetail).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      fireEvent.click(retry);
      await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
      expect(retry).toHaveFocus();
      expect(screen.getByTestId("task-mail-load-error")).toHaveTextContent("邮件暂时读不到");
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
      expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
      expect(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" })).toBeEnabled();
      expect(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" })).toHaveClass(
        "opacity-50",
      );

      release?.(openedMail("m1", "延期邮件全文"));
      expect(await screen.findByText("延期邮件全文")).toBeInTheDocument();
      expect(screen.queryByTestId("task-mail-load-error")).not.toBeInTheDocument();
    });
  });

  it("does not open the same cited mail twice and keeps focus until the dialog", async () => {
    const cited: WorkDelivery = {
      ...currentDelivery,
      findings: [{ text: "排期推迟", kind: "risk", source_ids: ["email:m1", "email:m10"] }],
      sources: [
        { id: "email:m1", type: "email", title: "延期邮件" },
        { id: "email:m10", type: "email", title: "另一封" },
      ],
    };
    const task: WorkItem = {
      ...briefTask,
      delivery_bundle: {
        ...briefTask.delivery_bundle!,
        current: cited,
        deliveries: [historySummary, { ...currentSummary, ...cited }],
      },
    };
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [task];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(task);
    let release: ((row: ReturnType<typeof openedMail>) => void) | undefined;
    vi.mocked(getInboxEmailDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    try {
      renderTasks("/tasks/brief_1");
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      const otherRow = screen.getByTestId("delivery-source-email:m10");
      const open = within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" });
      const other = within(otherRow).getByRole("button", { name: "打开邮件 另一封" });
      const chip = within(screen.getByTestId("delivery-findings")).getByRole("button", {
        name: "来源 email:m1",
      });
      open.focus();
      fireEvent.click(open);
      fireEvent.click(open);
      chip.focus();
      fireEvent.click(chip);
      await waitFor(() => expect(open).toHaveAttribute("aria-busy", "true"));
      expect(open).toBeEnabled();
      expect(chip).toBeEnabled();
      expect(chip).toHaveFocus();
      expect(open).not.toHaveFocus();
      expect(open).toHaveClass("opacity-50");
      expect(open).not.toHaveTextContent("加载中");
      expect(chip).toHaveAttribute("aria-busy", "true");
      expect(chip).toHaveClass("opacity-50");
      expect(other).not.toHaveAttribute("aria-busy");
      expect(getInboxEmailDetail).toHaveBeenCalledTimes(1);
      expect(getInboxEmailDetail).toHaveBeenCalledWith("m1");

      release?.(openedMail("m1", "延期邮件全文"));
      const dialog = await screen.findByRole("dialog", { name: "延期邮件全文" });
      await waitFor(() => expect(dialog).toHaveFocus());
      expect(open).not.toHaveAttribute("aria-busy");
      expect(chip).not.toHaveAttribute("aria-busy");
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(chip).toHaveFocus());
      expect(open).not.toHaveFocus();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      open.focus();
      fireEvent.click(open);
      await waitFor(() => expect(getInboxEmailDetail).toHaveBeenCalledTimes(2));
      expect(open).toHaveAttribute("aria-busy", "true");
      expect(open).toHaveFocus();
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScroll;
    }
  });

  it("does not pull focus back to the cited mail button before the dialog opens", async () => {
    let release: ((row: ReturnType<typeof openedMail>) => void) | undefined;
    vi.mocked(getInboxEmailDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      const otherRow = screen.getByTestId("delivery-source-email:m10");
      const open = within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" });
      const other = within(otherRow).getByRole("button", { name: "打开邮件 另一封" });
      open.focus();
      fireEvent.click(open);
      await waitFor(() => expect(open).toHaveAttribute("aria-busy", "true"));
      other.focus();
      expect(open).not.toHaveFocus();
      expect(other).toHaveFocus();

      release?.(openedMail("m1", "延期邮件全文"));
      const dialog = await screen.findByRole("dialog", { name: "延期邮件全文" });
      await waitFor(() => expect(dialog).toHaveFocus());
      expect(open).not.toHaveFocus();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(other).toHaveFocus());
      expect(open).not.toHaveFocus();
      expect(getInboxEmailDetail).toHaveBeenCalledTimes(1);
    });
  });

  it("lets another cited mail open while the first read is still in flight", async () => {
    const releaseFor = new Map<string, (row: ReturnType<typeof openedMail>) => void>();
    vi.mocked(getInboxEmailDetail).mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          releaseFor.set(id, resolve);
        }),
    );
    await withMailBrief(async () => {
      const firstRow = await screen.findByTestId("delivery-source-email:m1");
      const secondRow = screen.getByTestId("delivery-source-email:m10");
      const first = within(firstRow).getByRole("button", { name: "打开邮件 延期邮件" });
      const second = within(secondRow).getByRole("button", { name: "打开邮件 另一封" });
      first.focus();
      fireEvent.click(first);
      await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
      second.focus();
      fireEvent.click(second);
      await waitFor(() => expect(second).toHaveAttribute("aria-busy", "true"));
      expect(second).toBeEnabled();
      expect(second).toHaveFocus();
      expect(first).not.toHaveAttribute("aria-busy");
      expect(getInboxEmailDetail).toHaveBeenCalledTimes(2);
      expect(getInboxEmailDetail).toHaveBeenNthCalledWith(1, "m1");
      expect(getInboxEmailDetail).toHaveBeenNthCalledWith(2, "m10");

      releaseFor.get("m1")?.(openedMail("m1", "延期邮件全文"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("dialog", { name: "延期邮件全文" })).not.toBeInTheDocument();
      expect(second).toHaveFocus();

      releaseFor.get("m10")?.(openedMail("m10", "另一封全文"));
      const dialog = await screen.findByRole("dialog", { name: "另一封全文" });
      await waitFor(() => expect(dialog).toHaveFocus());
      expect(first).not.toHaveAttribute("aria-busy");
      expect(second).not.toHaveAttribute("aria-busy");
    });
  });

  it("drops the previous mail's open failure when another mail is opened", async () => {
    vi.mocked(getInboxEmailDetail).mockImplementation(async (id: string) => {
      if (id === "m1") throw new ApiError("邮件暂时读不到", 503);
      return new Promise(() => {});
    });
    await withMailBrief(async () => {
      const first = await screen.findByTestId("delivery-source-email:m1");
      const second = screen.getByTestId("delivery-source-email:m10");
      fireEvent.click(within(first).getByRole("button", { name: "打开邮件 延期邮件" }));
      expect(await screen.findByTestId("task-mail-load-error")).toHaveTextContent("邮件暂时读不到");

      fireEvent.click(within(second).getByRole("button", { name: "打开邮件 另一封" }));
      await waitFor(() =>
        expect(screen.queryByTestId("task-mail-load-error")).not.toBeInTheDocument(),
      );
      expect(screen.queryByText("邮件暂时读不到")).not.toBeInTheDocument();
      expect(screen.getByText("有进度风险")).toBeInTheDocument();
      expect(within(first).getByRole("button", { name: "打开邮件 延期邮件" })).toBeEnabled();
      expect(within(first).getByRole("button", { name: "打开邮件 延期邮件" })).not.toHaveAttribute(
        "aria-busy",
      );
      expect(within(second).getByRole("button", { name: "打开邮件 另一封" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
  });

  it("drops the cited-mail failure when a non-email source is opened", async () => {
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new ApiError("邮件暂时读不到", 503));
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));
      expect(await screen.findByTestId("task-mail-load-error")).toHaveTextContent("邮件暂时读不到");

      const findings = screen.getByTestId("delivery-findings");
      fireEvent.click(within(findings).getByRole("button", { name: "来源 file:abc" }));
      await waitFor(() =>
        expect(screen.queryByTestId("task-mail-load-error")).not.toBeInTheDocument(),
      );
      expect(screen.queryByText("邮件暂时读不到")).not.toBeInTheDocument();
      expect(getInboxEmailDetail).toHaveBeenCalledTimes(1);
      expect(screen.getByText("有进度风险")).toBeInTheDocument();
    });
  });

  it("clears the cited-mail failure when another delivery version is opened", async () => {
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new ApiError("邮件暂时读不到", 503));
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));
      expect(await screen.findByTestId("task-mail-load-error")).toHaveTextContent("邮件暂时读不到");

      fireEvent.click(screen.getByRole("button", { name: /v1 · 已要求返工/ }));
      expect(await screen.findByText("历史版本完整正文甲")).toBeInTheDocument();
      expect(screen.queryByTestId("task-mail-load-error")).not.toBeInTheDocument();
      expect(screen.queryByText("邮件暂时读不到")).not.toBeInTheDocument();
    });
  });

  it("uses the page fallback when opening a cited mail fails without a message", async () => {
    vi.mocked(getInboxEmailDetail).mockRejectedValue(new Error("   "));
    await withMailBrief(async () => {
      const emailRow = await screen.findByTestId("delivery-source-email:m1");
      fireEvent.click(within(emailRow).getByRole("button", { name: "打开邮件 延期邮件" }));
      expect(await screen.findByTestId("task-mail-load-error")).toHaveTextContent(
        "加载邮件详情失败",
      );
      expect(addError).toHaveBeenCalledWith("加载邮件详情失败", "任务");
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
      expect(screen.getByText("有进度风险")).toBeInTheDocument();
    });
  });

  it("shows a retry when the task list fails to load", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new ApiError("加载失败", 500));
    renderTasks("/tasks");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "任务");
    expect(screen.getByRole("heading", { name: "任务" })).toBeInTheDocument();
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
    expect(screen.queryByText("从项目资料简报开始：交办后可验收或返工。")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the page fallback when the task list error has no message", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new ApiError("   ", 500));
    renderTasks("/tasks");
    expect(await screen.findByRole("alert")).toHaveTextContent("加载任务失败");
    expect(addError).toHaveBeenCalledWith("加载任务失败", "任务");
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
  });

  it("keeps the task list retry mounted until the reread finishes", async () => {
    vi.mocked(listWorkItems).mockRejectedValueOnce(new ApiError("加载失败", 500));
    renderTasks("/tasks");
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    const pending: Array<(rows: WorkItem[]) => void> = [];
    vi.mocked(listWorkItems).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("tasks-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();

    pending.splice(0).forEach((resolve) => resolve([]));
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-load-error")).not.toBeInTheDocument();
  });

  it("keeps the task list when the detail read fails and retries", async () => {
    vi.mocked(getWorkItem).mockRejectedValue(new ApiError("详情失败", 500));
    renderTasks("/tasks/task_1");

    const alert = await screen.findByTestId("task-detail-load-error", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("详情失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("任务不存在")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /整理报告/ })).toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy", "true"), { timeout: 4000 });
    await waitFor(() => expect(retry).toHaveFocus());

    vi.mocked(getWorkItem).mockResolvedValue(sampleTask);
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "执行" })).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-load-error")).not.toBeInTheDocument();
  });

  it("keeps not-found copy when the task detail is missing", async () => {
    vi.mocked(getWorkItem).mockRejectedValue(new ApiError("missing", 404));
    renderTasks("/tasks/missing");
    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
  });

  it("shows the list failure beside an open task without taking focus", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new ApiError("列表失败", 500));
    renderTasks("/tasks/task_1");

    expect(await screen.findByRole("button", { name: "执行" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "任务列表" });
    const alert = within(list).getByRole("alert");
    expect(alert).toHaveTextContent("列表失败");
    expect(within(list).queryByText("暂无其他任务")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "重试" })).not.toHaveFocus();
  });

  it("does not show a metrics error after a successful empty window", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    vi.mocked(getDeliveryMetrics).mockResolvedValue({
      window_days: 30,
      reviewed_tasks: 0,
      accepted_tasks: 0,
      first_reviewed_tasks: 0,
      first_version_accepted_tasks: 0,
      first_version_acceptance_rate: null,
      rework_count: 0,
      adopted_action_count: 0,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: 0,
        recovery_interventions: 0,
        llm_cost: 0,
        unattributed_project_brief_calls: 0,
        unattributed_project_brief_cost: 0,
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    renderTasks("/tasks");
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-metrics-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("近 30 日简报")).not.toBeInTheDocument();
  });

  it("shows a retry when delivery metrics fail and there is no summary yet", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    vi.mocked(getDeliveryMetrics).mockRejectedValue(new ApiError("指标暂时读不到", 503));
    renderTasks("/tasks");
    const alert = await screen.findByTestId("delivery-metrics-load-error");
    expect(alert).toHaveTextContent("指标暂时读不到");
    expect(screen.queryByText("近 30 日简报")).not.toBeInTheDocument();
    expect(screen.getByText("暂无任务")).toBeInTheDocument();
    expect(addError).toHaveBeenCalledWith("指标暂时读不到", "任务");
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the metrics fallback when the summary error has no message", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    vi.mocked(getDeliveryMetrics).mockRejectedValue(new ApiError("   ", 500));
    renderTasks("/tasks");
    const alert = await screen.findByTestId("delivery-metrics-load-error");
    expect(alert).toHaveTextContent("加载简报指标失败");
    expect(addError).toHaveBeenCalledWith("加载简报指标失败", "任务");
    expect(screen.queryByText("近 30 日简报")).not.toBeInTheDocument();
  });

  it("keeps the metrics retry mounted until the reread finishes", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    let release: ((value: Awaited<ReturnType<typeof getDeliveryMetrics>>) => void) | undefined;
    vi.mocked(getDeliveryMetrics)
      .mockRejectedValueOnce(new ApiError("指标暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    renderTasks("/tasks");
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(screen.getByTestId("delivery-metrics-load-error")).toHaveTextContent("指标暂时读不到");
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("delivery-metrics-load-error")).toHaveTextContent("指标暂时读不到");
    expect(screen.queryByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByText("近 30 日简报")).not.toBeInTheDocument();

    release?.({
      window_days: 30,
      reviewed_tasks: 0,
      accepted_tasks: 0,
      first_reviewed_tasks: 0,
      first_version_accepted_tasks: 0,
      first_version_acceptance_rate: null,
      rework_count: 0,
      adopted_action_count: 0,
      average_review_latency_hours: null,
      attribution: {
        approval_interventions: 0,
        recovery_interventions: 0,
        llm_cost: 0,
        unattributed_project_brief_calls: 0,
        unattributed_project_brief_cost: 0,
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-metrics-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("近 30 日简报")).not.toBeInTheDocument();
  });

  it("keeps the window summary when a later read fails", async () => {
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [briefTask];
      return [];
    });
    vi.mocked(getWorkItem).mockResolvedValue(briefTask);
    vi.mocked(getDeliveryMetrics)
      .mockResolvedValueOnce({
        window_days: 30,
        reviewed_tasks: 2,
        accepted_tasks: 2,
        first_reviewed_tasks: 2,
        first_version_accepted_tasks: 1,
        first_version_acceptance_rate: 0.5,
        rework_count: 1,
        adopted_action_count: 1,
        average_review_latency_hours: 1.5,
        attribution: {
          approval_interventions: 2,
          recovery_interventions: 1,
          llm_cost: 0,
          unattributed_project_brief_calls: 0,
          unattributed_project_brief_cost: 0,
        },
        capped: false,
        cap_limit: 5000,
        items: [],
      })
      .mockRejectedValueOnce(new ApiError("指标暂时读不到", 503));
    renderTasks("/tasks/brief_1");

    expect(await screen.findByText("近 30 日简报")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("指标暂时读不到", "任务"));
    expect(screen.getByText("近 30 日简报")).toBeInTheDocument();
    expect(screen.getByText("首版采纳 50%（1/2）")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-metrics-load-error")).not.toBeInTheDocument();
  });

  it("does not move focus when the window summary fails beside an open task", async () => {
    vi.mocked(getDeliveryMetrics).mockRejectedValue(new ApiError("指标暂时读不到", 503));
    renderTasks("/tasks/task_1");
    expect(await screen.findByRole("button", { name: "执行" })).toBeInTheDocument();
    const alert = screen.getByTestId("delivery-metrics-load-error");
    expect(alert).toHaveTextContent("指标暂时读不到");
    expect(within(alert).getByRole("button", { name: "重试" })).not.toHaveFocus();
  });

  it("leaves focus on the task list retry when the summary also fails", async () => {
    vi.mocked(listWorkItems).mockRejectedValue(new ApiError("列表失败", 500));
    vi.mocked(getDeliveryMetrics).mockRejectedValue(new ApiError("指标暂时读不到", 503));
    renderTasks("/tasks");
    const metrics = await screen.findByTestId("delivery-metrics-load-error");
    const list = await screen.findByTestId("tasks-load-error");
    expect(metrics).toHaveTextContent("指标暂时读不到");
    expect(list).toHaveTextContent("列表失败");
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument();
    await waitFor(() => expect(within(list).getByRole("button", { name: "重试" })).toHaveFocus());
    expect(within(metrics).getByRole("button", { name: "重试" })).not.toHaveFocus();
  });

  it("keeps the brief draft until create succeeds and ignores dismiss while creating", async () => {
    const pending = deferred<WorkItem>();
    vi.mocked(createProjectBrief).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目资料简报" });
    const title = within(dialog).getByPlaceholderText("项目 A 简报");
    const objective = within(dialog).getByPlaceholderText(/整理最近三天的邮件/);
    const query = within(dialog).getByPlaceholderText("关键词（可选）");
    const days = within(dialog).getByPlaceholderText("最近天数");
    const files = within(dialog).getByPlaceholderText("C:\\notes\\project-a.md");
    const mailbox = within(dialog).getByRole("checkbox", { name: "读取已配置邮箱" });
    fireEvent.change(title, { target: { value: "  项目 A 简报  " } });
    fireEvent.change(objective, { target: { value: "  整理最近三天邮件  " } });
    fireEvent.change(query, { target: { value: "账单" } });
    fireEvent.change(days, { target: { value: "9" } });
    fireEvent.change(files, { target: { value: "  C:\\notes\\a.md  " } });
    const create = within(dialog).getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);

    const creating = await within(dialog).findByRole("button", { name: "创建中..." });
    expect(creating).toBeEnabled();
    expect(creating).toHaveFocus();
    expect(creating).toHaveAttribute("aria-busy", "true");
    fireEvent.click(creating);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);

    expect(createProjectBrief).toHaveBeenCalledTimes(1);
    expect(createProjectBrief).toHaveBeenCalledWith({
      title: "项目 A 简报",
      objective: "整理最近三天邮件",
      source_scope: {
        email: { enabled: true, query: "账单", days: 9 },
        files: [{ path: "C:\\notes\\a.md" }],
      },
    });
    expect(title).toHaveValue("  项目 A 简报  ");
    expect(objective).toHaveValue("  整理最近三天邮件  ");
    expect(query).toHaveValue("账单");
    expect(days).toHaveValue("9");
    expect(files).toHaveValue("  C:\\notes\\a.md  ");
    expect(title).toBeEnabled();
    expect(objective).toBeEnabled();
    expect(mailbox).toBeChecked();
    expect(mailbox).toBeEnabled();
    expect(creating).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    pending.reject(new ApiError("创建任务失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建任务失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(title).toHaveValue("  项目 A 简报  ");
    expect(objective).toHaveValue("  整理最近三天邮件  ");
    expect(files).toHaveValue("  C:\\notes\\a.md  ");
    expect(title).toBeEnabled();
    expect(mailbox).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "创建" })).toHaveFocus();

    vi.mocked(createProjectBrief).mockResolvedValueOnce(briefTask);
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "新建项目资料简报" })).not.toBeInTheDocument(),
    );
    expect(createProjectBrief).toHaveBeenCalledTimes(2);
  });

  it("keeps a title typed during create and does not pull focus back", async () => {
    const pending = deferred<WorkItem>();
    vi.mocked(createProjectBrief).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目资料简报" });
    const title = within(dialog).getByPlaceholderText("项目 A 简报");
    const objective = within(dialog).getByPlaceholderText(/整理最近三天的邮件/);
    fireEvent.change(title, { target: { value: "项目 A" } });
    fireEvent.change(objective, { target: { value: "整理邮件" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await within(dialog).findByRole("button", { name: "创建中..." });
    title.focus();
    fireEvent.change(title, { target: { value: "项目 A，再补风险" } });
    const opener = screen.getByRole("button", { name: "新建简报" });
    opener.focus();

    pending.resolve({ ...briefTask, id: "brief_new", title: "项目 A" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "创建中..." })).not.toBeInTheDocument(),
    );
    expect(dialog).toBeInTheDocument();
    expect(title).toHaveValue("项目 A，再补风险");
    expect(objective).toHaveValue("整理邮件");
    expect(opener).toHaveFocus();
    expect(createProjectBrief).toHaveBeenCalledTimes(1);
    expect(createProjectBrief).toHaveBeenCalledWith({
      title: "项目 A",
      objective: "整理邮件",
      source_scope: {
        email: { enabled: true, query: "", days: 3 },
        files: [],
      },
    });
  });

  it("returns focus to the title when create succeeds after the draft changed", async () => {
    const pending = deferred<WorkItem>();
    vi.mocked(createProjectBrief).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目资料简报" });
    const title = within(dialog).getByPlaceholderText("项目 A 简报");
    fireEvent.change(title, { target: { value: "项目 A" } });
    fireEvent.change(within(dialog).getByPlaceholderText(/整理最近三天的邮件/), {
      target: { value: "整理邮件" },
    });
    const create = within(dialog).getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    await within(dialog).findByRole("button", { name: "创建中..." });
    fireEvent.change(title, { target: { value: "项目 A，再补风险" } });

    const focusWhenSettled = captureFocusWhenGone(
      () => !within(dialog).queryByRole("button", { name: "创建中..." }),
    );
    pending.resolve({ ...briefTask, id: "brief_new", title: "项目 A" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(focusWhenSettled.read()).toBe(title);
    expect(focusWhenSettled.read()).not.toBe(document.body);
    expect(dialog).toBeInTheDocument();
    expect(title).toHaveValue("项目 A，再补风险");
    expect(createProjectBrief).toHaveBeenCalledTimes(1);
  });

  it("focuses the title before paint when a kept draft disables create", async () => {
    const pending = deferred<WorkItem>();
    vi.mocked(createProjectBrief).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "新建简报" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目资料简报" });
    const title = within(dialog).getByPlaceholderText("项目 A 简报");
    fireEvent.change(title, { target: { value: "项目 A" } });
    fireEvent.change(within(dialog).getByPlaceholderText(/整理最近三天的邮件/), {
      target: { value: "整理邮件" },
    });
    const create = within(dialog).getByRole("button", { name: "创建" });
    create.focus();
    fireEvent.click(create);
    await within(dialog).findByRole("button", { name: "创建中..." });
    fireEvent.change(title, { target: { value: "   " } });

    const focusWhenDisabled = captureFocusWhenGone(() => {
      const button = within(dialog).queryByRole("button", { name: "创建" });
      return button instanceof HTMLButtonElement && button.disabled;
    });
    await act(async () => {
      pending.resolve({ ...briefTask, id: "brief_new", title: "项目 A" });
    });
    expect(title).toHaveFocus();
    expect(focusWhenDisabled.read()).toBe(title);
    expect(focusWhenDisabled.read()).not.toBe(document.body);
    expect(within(dialog).getByRole("button", { name: "创建" })).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    expect(title).toHaveValue("   ");
  });

  it("keeps the acceptance note until accept succeeds and ignores dismiss while accepting", async () => {
    mockBriefList();
    const pending = deferred<Awaited<ReturnType<typeof acceptWorkDelivery>>>();
    vi.mocked(acceptWorkDelivery).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "验收" }));
    const dialog = await screen.findByRole("dialog", { name: "验收交付" });
    const note = within(dialog).getByPlaceholderText("例如：结论和来源都齐了。");
    fireEvent.change(note, { target: { value: "  来源齐全  " } });
    const accept = within(dialog).getByRole("button", { name: "确认验收" });
    accept.focus();
    fireEvent.click(accept);

    const accepting = await within(dialog).findByRole("button", { name: "验收中..." });
    expect(accepting).toBeEnabled();
    expect(accepting).toHaveFocus();
    expect(accepting).toHaveAttribute("aria-busy", "true");
    const opener = screen.getByRole("button", { name: "验收" });
    expect(opener).toBeEnabled();
    expect(opener).toHaveAttribute("aria-busy", "true");
    expect(opener).toHaveClass("opacity-50");
    opener.focus();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(acceptWorkDelivery).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    accepting.focus();
    fireEvent.click(accepting);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(acceptWorkDelivery).toHaveBeenCalledTimes(1);
    expect(acceptWorkDelivery).toHaveBeenCalledWith("brief_1", "d2", {
      reason: "来源齐全",
      idempotency_key: expect.any(String),
    });
    expect(note).toHaveValue("  来源齐全  ");
    expect(note).toBeEnabled();
    expect(accepting).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    pending.reject(new ApiError("验收失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("验收失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(note).toHaveValue("  来源齐全  ");
    expect(note).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认验收" })).toHaveFocus();

    const key = vi.mocked(acceptWorkDelivery).mock.calls[0]?.[2]?.idempotency_key;
    vi.mocked(acceptWorkDelivery).mockResolvedValueOnce({
      replayed: false,
      work_id: "brief_1",
      decision: {},
      bundle: briefTask.delivery_bundle!,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认验收" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "验收交付" })).not.toBeInTheDocument(),
    );
    expect(acceptWorkDelivery).toHaveBeenCalledTimes(2);
    expect(acceptWorkDelivery).toHaveBeenLastCalledWith("brief_1", "d2", {
      reason: "来源齐全",
      idempotency_key: key,
    });
  });

  it("moves focus to the open task in the same turn 验收 leaves after accept", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(acceptWorkDelivery).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = withReview(box.item, "accepted");
            resolve({
              replayed: false,
              work_id: "brief_1",
              decision: {},
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    const accept = await screen.findByRole("button", { name: "验收" });
    accept.focus();
    fireEvent.click(accept);
    const dialog = await screen.findByRole("dialog", { name: "验收交付" });
    const confirm = within(dialog).getByRole("button", { name: "确认验收" });
    confirm.focus();
    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "验收中..." });

    let focusWhenGone: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("button", { name: "验收" })) return;
      focusWhenGone ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "验收" })).not.toBeInTheDocument(),
    );
    observer.disconnect();
    expect(screen.queryByRole("button", { name: "返工" })).not.toBeInTheDocument();
    expect(focusWhenGone).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
  });

  it("focuses 返回列表 when the open task link is hidden after 验收 leaves", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(acceptWorkDelivery).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = withReview(box.item, "accepted");
            resolve({
              replayed: false,
              work_id: "brief_1",
              decision: {},
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    const hidden = hideTaskList();
    try {
      renderTasks("/tasks/brief_1");
      fireEvent.click(await screen.findByRole("button", { name: "验收" }));
      fireEvent.click(await screen.findByRole("button", { name: "确认验收" }));
      await act(async () => {
        release();
      });
      await waitFor(() => expect(screen.getByRole("link", { name: "返回列表" })).toHaveFocus());
      expect(currentTaskLink()).not.toHaveFocus();
    } finally {
      hidden.mockRestore();
    }
  });

  it("keeps focus on 验收 until the delivery refreshes, and does not steal it after it moved", async () => {
    let item = briefTask;
    let hangDetail = false;
    let releaseDetail: (() => void) | null = null;
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [item];
      return [];
    });
    vi.mocked(getWorkItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!hangDetail) {
            resolve(item);
            return;
          }
          releaseDetail = () => resolve(item);
        }),
    );
    vi.mocked(acceptWorkDelivery).mockResolvedValue({
      replayed: false,
      work_id: "brief_1",
      decision: {},
      bundle: briefTask.delivery_bundle!,
    });
    renderTasks("/tasks/brief_1");
    const opener = await screen.findByRole("button", { name: "验收" });
    opener.focus();
    fireEvent.click(opener);
    hangDetail = true;
    fireEvent.click(await screen.findByRole("button", { name: "确认验收" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "验收交付" })).not.toBeInTheDocument(),
    );
    const accept = screen.getByRole("button", { name: "验收" });
    expect(accept).toHaveFocus();
    const create = screen.getByRole("button", { name: "新建简报" });
    create.focus();

    item = withReview(item, "accepted");
    expect(releaseDetail).not.toBeNull();
    await act(async () => {
      releaseDetail?.();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "验收" })).not.toBeInTheDocument(),
    );
    expect(create).toHaveFocus();
    expect(currentTaskLink()).not.toHaveFocus();
  });

  it("moves focus to the open task in the same turn 返工 leaves after rework", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(reworkWorkDelivery).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = withReview(box.item, "changes_requested");
            resolve({
              replayed: false,
              work_id: "brief_1",
              decision: {},
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    fireEvent.click(await screen.findByRole("button", { name: "返工" }));
    const dialog = await screen.findByRole("dialog", { name: "请求返工" });
    fireEvent.change(within(dialog).getByPlaceholderText("例如：补上风险，并给每条结论带来源。"), {
      target: { value: "补上风险" },
    });
    const confirm = within(dialog).getByRole("button", { name: "确认返工" });
    confirm.focus();
    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "返工中..." });

    let focusWhenGone: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("button", { name: "返工" })) return;
      focusWhenGone ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "返工" })).not.toBeInTheDocument(),
    );
    observer.disconnect();
    expect(focusWhenGone).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
  });

  it("moves focus to the open task in the same turn 执行 leaves after execute", async () => {
    const box = trackTask(sampleTask, "task");
    let release: () => void = () => {};
    vi.mocked(executeWorkItem).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = asRunning(box.item);
            resolve(box.item);
          };
        }),
    );
    renderTasks("/tasks/task_1");
    const execute = await screen.findByRole("button", { name: "执行" });
    execute.focus();
    fireEvent.click(execute);
    const dialog = await screen.findByRole("dialog", { name: "确认执行计划" });
    const confirm = within(dialog).getByRole("button", { name: "确认执行" });
    confirm.focus();
    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "执行中..." });

    let focusWhenGone: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("button", { name: "执行" })) return;
      focusWhenGone ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument(),
    );
    observer.disconnect();
    expect(screen.queryByRole("button", { name: "重新执行" })).not.toBeInTheDocument();
    expect(focusWhenGone).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
  });

  it("focuses 返回列表 when the open task link is hidden after 执行 leaves", async () => {
    const box = trackTask(sampleTask, "task");
    let release: () => void = () => {};
    vi.mocked(executeWorkItem).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = asRunning(box.item);
            resolve(box.item);
          };
        }),
    );
    const hidden = hideTaskList();
    try {
      renderTasks("/tasks/task_1");
      fireEvent.click(await screen.findByRole("button", { name: "执行" }));
      fireEvent.click(await screen.findByRole("button", { name: "确认执行" }));
      await act(async () => {
        release();
      });
      await waitFor(() => expect(screen.getByRole("link", { name: "返回列表" })).toHaveFocus());
      expect(currentTaskLink()).not.toHaveFocus();
    } finally {
      hidden.mockRestore();
    }
  });

  it("keeps focus on 执行 until the status refreshes, and does not steal it after it moved", async () => {
    let item = sampleTask;
    let hangDetail = false;
    let releaseDetail: (() => void) | null = null;
    vi.mocked(listWorkItems).mockImplementation(async (workType?: string) => {
      if (workType === "task") return [item];
      return [];
    });
    vi.mocked(getWorkItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!hangDetail) {
            resolve(item);
            return;
          }
          releaseDetail = () => resolve(item);
        }),
    );
    vi.mocked(executeWorkItem).mockResolvedValueOnce(sampleTask);
    renderTasks("/tasks/task_1");
    const opener = await screen.findByRole("button", { name: "执行" });
    opener.focus();
    fireEvent.click(opener);
    hangDetail = true;
    fireEvent.click(await screen.findByRole("button", { name: "确认执行" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "确认执行计划" })).not.toBeInTheDocument(),
    );
    const execute = screen.getByRole("button", { name: "执行" });
    expect(execute).toHaveFocus();
    const create = screen.getByRole("button", { name: "新建简报" });
    create.focus();

    item = asRunning(item);
    expect(releaseDetail).not.toBeNull();
    await act(async () => {
      releaseDetail?.();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument(),
    );
    expect(create).toHaveFocus();
    expect(currentTaskLink()).not.toHaveFocus();
  });

  it("moves focus to the open task in the same turn 再次运行 leaves after rerun", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(rerunProjectBrief).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = asRunning(box.item);
            resolve({
              work_id: "brief_1",
              supersedes_delivery_id: "d2",
              work: box.item,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    const rerun = await screen.findByRole("button", { name: "再次运行" });
    rerun.focus();
    fireEvent.click(rerun);
    const dialog = await screen.findByRole("dialog", { name: "再次运行同一份简报" });
    const confirm = within(dialog).getByRole("button", { name: "确认再次运行" });
    confirm.focus();
    fireEvent.click(confirm);
    await within(dialog).findByRole("button", { name: "再次运行中..." });

    let focusWhenGone: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("button", { name: "再次运行" })) return;
      focusWhenGone ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "再次运行" })).not.toBeInTheDocument(),
    );
    observer.disconnect();
    expect(screen.queryByRole("button", { name: "定时再次运行" })).not.toBeInTheDocument();
    expect(focusWhenGone).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
    expect(screen.getByRole("button", { name: "验收" })).not.toHaveFocus();
  });

  it("keeps the rework reason until rework succeeds and ignores dismiss while submitting", async () => {
    mockBriefList();
    const pending = deferred<Awaited<ReturnType<typeof reworkWorkDelivery>>>();
    vi.mocked(reworkWorkDelivery).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "返工" }));
    const dialog = await screen.findByRole("dialog", { name: "请求返工" });
    const reason = within(dialog).getByPlaceholderText("例如：补上风险，并给每条结论带来源。");
    fireEvent.change(reason, { target: { value: "  补上风险  " } });
    const rework = within(dialog).getByRole("button", { name: "确认返工" });
    rework.focus();
    fireEvent.click(rework);

    const submitting = await within(dialog).findByRole("button", { name: "返工中..." });
    expect(submitting).toBeEnabled();
    expect(submitting).toHaveFocus();
    expect(submitting).toHaveAttribute("aria-busy", "true");
    const opener = screen.getByRole("button", { name: "返工" });
    expect(opener).toBeEnabled();
    expect(opener).toHaveAttribute("aria-busy", "true");
    expect(opener).toHaveClass("opacity-50");
    opener.focus();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(reworkWorkDelivery).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    submitting.focus();
    fireEvent.click(submitting);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(reworkWorkDelivery).toHaveBeenCalledTimes(1);
    expect(reworkWorkDelivery).toHaveBeenCalledWith("brief_1", "d2", {
      reason: "补上风险",
      idempotency_key: expect.any(String),
    });
    expect(reason).toHaveValue("  补上风险  ");
    expect(reason).toBeEnabled();
    expect(submitting).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    pending.reject(new ApiError("返工失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("返工失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(reason).toHaveValue("  补上风险  ");
    expect(reason).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认返工" })).toHaveFocus();

    vi.mocked(reworkWorkDelivery).mockResolvedValueOnce({
      replayed: false,
      work_id: "brief_1",
      decision: {},
      bundle: briefTask.delivery_bundle!,
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认返工" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "请求返工" })).not.toBeInTheDocument(),
    );
    expect(reworkWorkDelivery).toHaveBeenCalledTimes(2);
  });

  it("keeps the schedule until it is set and ignores dismiss while submitting", async () => {
    mockBriefList();
    const pending = deferred<Awaited<ReturnType<typeof scheduleBriefRepeat>>>();
    vi.mocked(scheduleBriefRepeat).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "定时再次运行" }));
    const dialog = await screen.findByRole("dialog", { name: "定时再次运行这一份简报" });
    const hours = within(dialog).getByLabelText("小时");
    const minutes = within(dialog).getByLabelText("分钟");
    fireEvent.change(hours, { target: { value: "2" } });
    fireEvent.change(minutes, { target: { value: "15" } });
    const confirmSchedule = within(dialog).getByRole("button", { name: "确认定时" });
    confirmSchedule.focus();
    fireEvent.click(confirmSchedule);

    const setting = await within(dialog).findByRole("button", { name: "设定中..." });
    expect(setting).toBeEnabled();
    expect(setting).toHaveFocus();
    expect(setting).toHaveAttribute("aria-busy", "true");
    const opener = screen.getByRole("button", { name: "定时再次运行" });
    expect(opener).toBeEnabled();
    expect(opener).toHaveAttribute("aria-busy", "true");
    expect(opener).toHaveClass("opacity-50");
    opener.focus();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(scheduleBriefRepeat).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    setting.focus();
    fireEvent.click(setting);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(scheduleBriefRepeat).toHaveBeenCalledTimes(1);
    expect(scheduleBriefRepeat).toHaveBeenCalledWith("brief_1", { hours: 2, minutes: 15 });
    expect(hours).toHaveValue("2");
    expect(minutes).toHaveValue("15");
    expect(hours).toBeEnabled();
    expect(setting).toHaveFocus();
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByTestId("scheduled-repeat-note")).not.toBeInTheDocument();

    pending.reject(new ApiError("设定定时失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("设定定时失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(hours).toHaveValue("2");
    expect(minutes).toHaveValue("15");
    expect(hours).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认定时" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认定时" }));
    expect(await screen.findByTestId("scheduled-repeat-note")).toHaveTextContent(
      "2026-09-24T08:00:00Z",
    );
    expect(
      screen.queryByRole("dialog", { name: "定时再次运行这一份简报" }),
    ).not.toBeInTheDocument();
    expect(scheduleBriefRepeat).toHaveBeenCalledTimes(2);
  });

  it("keeps the execute confirm open until it succeeds and ignores dismiss while starting", async () => {
    const pending = deferred<WorkItem>();
    vi.mocked(executeWorkItem).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks/task_1");

    fireEvent.click(await screen.findByRole("button", { name: "执行" }));
    const dialog = await screen.findByRole("dialog", { name: "确认执行计划" });
    const confirmExecute = within(dialog).getByRole("button", { name: "确认执行" });
    confirmExecute.focus();
    fireEvent.click(confirmExecute);

    const starting = await within(dialog).findByRole("button", { name: "执行中..." });
    expect(starting).toBeEnabled();
    expect(starting).toHaveFocus();
    expect(starting).toHaveAttribute("aria-busy", "true");
    const opener = screen.getByRole("button", { name: "执行" });
    expect(opener).toBeEnabled();
    expect(opener).toHaveAttribute("aria-busy", "true");
    expect(opener).toHaveClass("opacity-50");
    opener.focus();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(executeWorkItem).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    starting.focus();
    fireEvent.click(starting);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(executeWorkItem).toHaveBeenCalledTimes(1);
    expect(executeWorkItem).toHaveBeenCalledWith("task_1");
    expect(dialog).toBeInTheDocument();

    pending.reject(new ApiError("启动任务失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("启动任务失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认执行" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认执行" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认执行" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "确认执行计划" })).not.toBeInTheDocument(),
    );
    expect(executeWorkItem).toHaveBeenCalledTimes(2);
  });

  it("keeps the rerun confirm open until it succeeds and ignores dismiss while starting", async () => {
    mockBriefList();
    const pending = deferred<Awaited<ReturnType<typeof rerunProjectBrief>>>();
    vi.mocked(rerunProjectBrief).mockImplementationOnce(() => pending.promise);
    renderTasks("/tasks/brief_1");

    fireEvent.click(await screen.findByRole("button", { name: "再次运行" }));
    const dialog = await screen.findByRole("dialog", { name: "再次运行同一份简报" });
    const confirmRerun = within(dialog).getByRole("button", { name: "确认再次运行" });
    confirmRerun.focus();
    fireEvent.click(confirmRerun);

    const starting = await within(dialog).findByRole("button", { name: "再次运行中..." });
    expect(starting).toBeEnabled();
    expect(starting).toHaveFocus();
    expect(starting).toHaveAttribute("aria-busy", "true");
    const opener = screen.getByRole("button", { name: "再次运行" });
    expect(opener).toBeEnabled();
    expect(opener).toHaveAttribute("aria-busy", "true");
    expect(opener).toHaveClass("opacity-50");
    opener.focus();
    expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(rerunProjectBrief).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    starting.focus();
    fireEvent.click(starting);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(rerunProjectBrief).toHaveBeenCalledTimes(1);
    expect(rerunProjectBrief).toHaveBeenCalledWith("brief_1");
    expect(dialog).toBeInTheDocument();

    pending.reject(new ApiError("再次运行失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("再次运行失败", "任务"));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认再次运行" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认再次运行" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认再次运行" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再次运行同一份简报" })).not.toBeInTheDocument(),
    );
    expect(rerunProjectBrief).toHaveBeenCalledTimes(2);
  });

  it("does not complete twice, keeps focus, then moves it to the open task", async () => {
    const box = trackTask(
      {
        ...sampleTask,
        id: "sug_1",
        title: "核对排期",
        status: "pending",
        executable_plan: JSON.stringify({ kind: "adopted_suggestion" }),
      },
      "task",
    );
    let release: () => void = () => {};
    vi.mocked(updateWorkItemStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = { ...box.item, status: "completed" };
            resolve(box.item);
          };
        }),
    );
    renderTasks("/tasks/sug_1");
    const done = await screen.findByRole("button", { name: "完成" });
    done.focus();
    fireEvent.click(done);
    fireEvent.click(done);
    await waitFor(() => expect(done).toHaveAttribute("aria-busy", "true"));
    expect(done).not.toBeDisabled();
    expect(done).toHaveFocus();
    expect(done).toHaveClass("opacity-50");
    expect(updateWorkItemStatus).toHaveBeenCalledTimes(1);
    expect(updateWorkItemStatus).toHaveBeenCalledWith("sug_1", "completed");

    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "完成" }),
    );
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "完成" })).not.toBeInTheDocument(),
    );
    expect(focusWhenGone.read()).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
    expect(currentTaskLink()).toHaveAttribute("data-task-current", "");
  });

  it("focuses 返回列表 when the open task link is hidden after 完成", async () => {
    const box = trackTask(
      {
        ...sampleTask,
        id: "sug_1",
        title: "核对排期",
        status: "pending",
        executable_plan: JSON.stringify({ kind: "adopted_suggestion" }),
      },
      "task",
    );
    let release: () => void = () => {};
    vi.mocked(updateWorkItemStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = { ...box.item, status: "completed" };
            resolve(box.item);
          };
        }),
    );
    const hidden = hideTaskList();
    try {
      renderTasks("/tasks/sug_1");
      const done = await screen.findByRole("button", { name: "完成" });
      done.focus();
      fireEvent.click(done);
      const focusWhenGone = captureFocusWhenGone(
        () => !screen.queryByRole("button", { name: "完成" }),
      );
      await act(async () => {
        release();
      });
      const back = screen.getByRole("link", { name: "返回列表" });
      await waitFor(() => expect(back).toHaveFocus());
      expect(focusWhenGone.read()).toBe(back);
      expect(currentTaskLink()).not.toHaveFocus();
    } finally {
      hidden.mockRestore();
    }
  });

  it("does not steal focus after 完成 when it already moved", async () => {
    const box = trackTask(
      {
        ...sampleTask,
        id: "sug_1",
        title: "核对排期",
        status: "pending",
        executable_plan: JSON.stringify({ kind: "adopted_suggestion" }),
      },
      "task",
    );
    let release: () => void = () => {};
    vi.mocked(updateWorkItemStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = { ...box.item, status: "completed" };
            resolve(box.item);
          };
        }),
    );
    renderTasks("/tasks/sug_1");
    const done = await screen.findByRole("button", { name: "完成" });
    const back = screen.getByRole("link", { name: "返回列表" });
    done.focus();
    fireEvent.click(done);
    back.focus();
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "完成" })).not.toBeInTheDocument(),
    );
    expect(back).toHaveFocus();
  });

  it("keeps 完成 focused when the status write fails", async () => {
    trackTask(
      {
        ...sampleTask,
        id: "sug_1",
        title: "核对排期",
        status: "pending",
        executable_plan: JSON.stringify({ kind: "adopted_suggestion" }),
      },
      "task",
    );
    let fail: (err: unknown) => void = () => {};
    vi.mocked(updateWorkItemStatus).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderTasks("/tasks/sug_1");
    const done = await screen.findByRole("button", { name: "完成" });
    done.focus();
    fireEvent.click(done);
    fireEvent.click(done);
    await waitFor(() => expect(done).toHaveAttribute("aria-busy", "true"));
    expect(updateWorkItemStatus).toHaveBeenCalledTimes(1);

    fail(new ApiError("完成任务失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("完成任务失败", "任务"));
    expect(done).toHaveFocus();
    expect(done).not.toBeDisabled();
    expect(done).not.toHaveAttribute("aria-busy");
  });

  it("does not cancel twice or open 执行, then focuses the open task", async () => {
    const box = trackTask(
      {
        ...sampleTask,
        id: "job_1",
        title: "夜间同步",
        work_type: "background",
        status: "pending",
        executable_plan: JSON.stringify({ steps: [{ tool: "write_file" }] }),
      },
      "background",
    );
    let release: () => void = () => {};
    vi.mocked(cancelWorkItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            box.item = { ...box.item, status: "cancelled" };
            resolve(box.item);
          };
        }),
    );
    renderTasks("/tasks/job_1");
    const cancel = await screen.findByRole("button", { name: "取消" });
    const execute = screen.getByRole("button", { name: "执行" });
    cancel.focus();
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    fireEvent.click(execute);
    await waitFor(() => expect(cancel).toHaveAttribute("aria-busy", "true"));
    expect(cancel).not.toBeDisabled();
    expect(cancel).toHaveFocus();
    expect(execute).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("dialog", { name: "确认执行计划" })).not.toBeInTheDocument();
    expect(cancelWorkItem).toHaveBeenCalledTimes(1);
    expect(cancelWorkItem).toHaveBeenCalledWith("job_1");

    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "取消" }),
    );
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "执行" })).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(currentTaskLink());
    expect(currentTaskLink()).toHaveFocus();
  });

  it("keeps 取消 focused when cancelling fails", async () => {
    trackTask(
      {
        ...sampleTask,
        id: "job_1",
        title: "夜间同步",
        work_type: "background",
        status: "pending",
      },
      "background",
    );
    let fail: (err: unknown) => void = () => {};
    vi.mocked(cancelWorkItem).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderTasks("/tasks/job_1");
    const cancel = await screen.findByRole("button", { name: "取消" });
    cancel.focus();
    fireEvent.click(cancel);
    await waitFor(() => expect(cancel).toHaveAttribute("aria-busy", "true"));

    fail(new ApiError("取消任务失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("取消任务失败", "任务"));
    expect(cancel).toHaveFocus();
    expect(cancel).not.toHaveAttribute("aria-busy");
  });

  it("does not adopt twice or open 验收, then focuses that 已转为任务 link", async () => {
    const box = trackTask(
      {
        ...briefTask,
        delivery_bundle: {
          ...briefTask.delivery_bundle!,
          current: {
            ...currentDelivery,
            suggested_actions: [{ title: "核对排期" }, { title: "再问一句" }],
          },
        },
      },
      "task",
    );
    let release: () => void = () => {};
    vi.mocked(adoptSuggestedAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            const bundle = box.item.delivery_bundle!;
            box.item = {
              ...box.item,
              delivery_bundle: {
                ...bundle,
                current: {
                  ...bundle.current!,
                  suggested_actions: [
                    { title: "核对排期", adopted_work_id: "todo_1" },
                    { title: "再问一句" },
                  ],
                },
              },
            };
            resolve({
              work_id: box.item.id,
              replayed: false,
              action_index: 0,
              created_work_id: "todo_1",
              work: box.item,
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    const adoptButtons = await screen.findAllByRole("button", { name: "转为任务" });
    expect(adoptButtons).toHaveLength(2);
    const first = adoptButtons[0];
    const second = adoptButtons[1];
    const accept = screen.getByRole("button", { name: "验收" });
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(accept);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    expect(first).not.toBeDisabled();
    expect(first).toHaveFocus();
    expect(second).not.toHaveAttribute("aria-busy");
    expect(second).not.toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "验收交付" })).not.toBeInTheDocument();
    expect(adoptSuggestedAction).toHaveBeenCalledTimes(1);

    const focusWhenGone = captureFocusWhenGone(
      () => screen.queryAllByRole("button", { name: "转为任务" }).length < 2,
    );
    await act(async () => {
      release();
    });
    const link = await screen.findByRole("link", { name: "已转为任务" });
    expect(focusWhenGone.read()).toBe(link);
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute("href", "/tasks/todo_1");
    expect(screen.getByRole("button", { name: "转为任务" })).toBeInTheDocument();
    expect(adoptSuggestedAction).toHaveBeenCalledTimes(1);
  });

  it("does not accept a delivery while 转为任务 is still in flight", async () => {
    trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(adoptSuggestedAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              work_id: "brief_1",
              replayed: false,
              action_index: 0,
              created_work_id: "todo_1",
              work: briefTask,
              bundle: briefTask.delivery_bundle!,
            });
        }),
    );
    renderTasks("/tasks/brief_1");
    fireEvent.click(await screen.findByRole("button", { name: "验收" }));
    const dialog = await screen.findByRole("dialog", { name: "验收交付" });
    fireEvent.click(screen.getByRole("button", { name: "转为任务" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "转为任务" })).toHaveAttribute("aria-busy", "true"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认验收" }));
    expect(acceptWorkDelivery).not.toHaveBeenCalled();
    expect(adoptSuggestedAction).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "转为任务" })).not.toHaveAttribute("aria-busy"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认验收" }));
    await waitFor(() => expect(acceptWorkDelivery).toHaveBeenCalledTimes(1));
  });

  it("does not steal focus after 转为任务 when it already moved", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(adoptSuggestedAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            const bundle = box.item.delivery_bundle!;
            box.item = {
              ...box.item,
              delivery_bundle: {
                ...bundle,
                current: {
                  ...bundle.current!,
                  suggested_actions: [{ title: "核对排期", adopted_work_id: "   " }],
                },
              },
            };
            resolve({
              work_id: box.item.id,
              replayed: false,
              action_index: 0,
              created_work_id: "todo_1",
              work: box.item,
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    const adopt = await screen.findByRole("button", { name: "转为任务" });
    const accept = screen.getByRole("button", { name: "验收" });
    adopt.focus();
    fireEvent.click(adopt);
    accept.focus();
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "转为任务" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("已转为任务").closest("a")).toBeNull();
    expect(accept).toHaveFocus();
    expect(currentTaskLink()).not.toHaveFocus();
  });

  it("focuses the open task when 转为任务 succeeds without a link", async () => {
    const box = trackTask(briefTask, "task");
    let release: () => void = () => {};
    vi.mocked(adoptSuggestedAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            const bundle = box.item.delivery_bundle!;
            box.item = {
              ...box.item,
              delivery_bundle: {
                ...bundle,
                current: {
                  ...bundle.current!,
                  suggested_actions: [{ title: "核对排期", adopted_work_id: "   " }],
                },
              },
            };
            resolve({
              work_id: box.item.id,
              replayed: false,
              action_index: 0,
              created_work_id: "todo_1",
              work: box.item,
              bundle: box.item.delivery_bundle!,
            });
          };
        }),
    );
    renderTasks("/tasks/brief_1");
    const adopt = await screen.findByRole("button", { name: "转为任务" });
    adopt.focus();
    fireEvent.click(adopt);
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "转为任务" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(currentTaskLink()).toHaveFocus());
  });

  it("keeps 转为任务 focused when adopting fails", async () => {
    trackTask(briefTask, "task");
    let fail: (err: unknown) => void = () => {};
    vi.mocked(adoptSuggestedAction).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderTasks("/tasks/brief_1");
    const adopt = await screen.findByRole("button", { name: "转为任务" });
    adopt.focus();
    fireEvent.click(adopt);
    fireEvent.click(adopt);
    await waitFor(() => expect(adopt).toHaveAttribute("aria-busy", "true"));
    expect(adoptSuggestedAction).toHaveBeenCalledTimes(1);

    fail(new ApiError("转为任务失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("转为任务失败", "任务"));
    expect(adopt).toHaveFocus();
    expect(adopt).not.toBeDisabled();
    expect(adopt).not.toHaveAttribute("aria-busy");
  });
});
