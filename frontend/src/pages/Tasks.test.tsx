import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import TasksPage from "./Tasks";
import {
  acceptWorkDelivery,
  adoptSuggestedAction,
  createProjectBrief,
  executeWorkItem,
  getDeliveryMetrics,
  getWorkDelivery,
  getWorkItem,
  listWorkItems,
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
    cancelWorkItem: vi.fn(),
    createProjectBrief: vi.fn(),
    acceptWorkDelivery: vi.fn().mockResolvedValue({ replayed: false }),
    reworkWorkDelivery: vi.fn().mockResolvedValue({ replayed: false }),
    adoptSuggestedAction: vi.fn().mockResolvedValue({ replayed: false, work: { id: "todo_1" } }),
    updateWorkItemStatus: vi.fn().mockResolvedValue({}),
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
      },
      capped: false,
      cap_limit: 5000,
      items: [],
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
        approval_interventions: "unavailable",
        recovery_interventions: "unavailable",
        llm_cost: "unavailable",
      },
      capped: false,
      cap_limit: 5000,
      items: [],
    });
    renderTasks("/tasks");
    expect(await screen.findByText("近 30 日简报")).toBeInTheDocument();
    expect(screen.getByText("首版采纳 50%（1/2）")).toBeInTheDocument();
    expect(screen.getByText(/返工 1 · 已转任务 1 · 平均评审 1.5 小时/)).toBeInTheDocument();
  });

  it("renders empty tasks shell", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    renderTasks("/tasks");
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("交办、交付与验收")).toBeInTheDocument();
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
    await waitFor(() => {
      expect(acceptWorkDelivery).toHaveBeenCalledWith(
        "brief_1",
        "d2",
        expect.objectContaining({ idempotency_key: expect.any(String) }),
      );
    });
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
});
