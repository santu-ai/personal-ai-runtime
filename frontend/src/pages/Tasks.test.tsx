import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import TasksPage from "./Tasks";
import {
  acceptWorkDelivery,
  adoptSuggestedAction,
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
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
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

function renderTasks(path: string) {
  return renderWithRouter(
    <Routes>
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/tasks/:taskId" element={<TasksPage />} />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe("TasksPage", () => {
  beforeEach(() => {
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
    expect(screen.getByText("审批 2 · 恢复 1 · 模型成本未分开计")).toBeInTheDocument();
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
      await screen.findByText("审批 0 · 恢复 0 · 模型成本 $0.0125 · 未归因 $1.9000（2 次）"),
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
      await screen.findByText("审批 0 · 恢复 0 · 模型成本 $0.0000 · 未归因 $2.2500（3 次）"),
    ).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: /整理报告/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "返回列表" }).parentElement).toHaveClass("lg:hidden");
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
});
