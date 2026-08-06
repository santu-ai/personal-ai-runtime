import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import TasksPage from "./Tasks";
import { executeWorkItem, getWorkItem, listWorkItems } from "../api/client";

vi.mock("../api/client", () => ({
  listWorkItems: vi.fn(),
  getWorkItem: vi.fn(),
  executeWorkItem: vi.fn().mockResolvedValue({}),
  cancelWorkItem: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
}));

const sampleTask = {
  id: "task_1",
  title: "整理报告",
  description: null,
  work_type: "task" as const,
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
  });

  it("renders empty tasks shell", async () => {
    vi.mocked(listWorkItems).mockResolvedValue([]);
    renderTasks("/tasks");
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("后台与可执行任务")).toBeInTheDocument();
  });

  it("shows previous_output and asks for plan confirmation before execute", async () => {
    renderTasks("/tasks/task_1");

    expect(await screen.findByText("执行日志")).toBeInTheDocument();
    expect(screen.getByText("wrote draft")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(await screen.findByText("确认执行计划")).toBeInTheDocument();
    expect(screen.getByText(/将从第 1 \/ 2 步开始执行/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(executeWorkItem).toHaveBeenCalledWith("task_1");
    });
  });
});
