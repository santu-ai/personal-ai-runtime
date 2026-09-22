import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import GoalsPage from "./Goals";
import { getGoal, listGoals, type WorkItem } from "../api/client";

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
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
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

    expect(await screen.findByRole("button", { name: /学习 Rust/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "返回列表" }).parentElement).toHaveClass("lg:hidden");
    expect(screen.getByRole("button", { name: /学习 Rust/ })).toHaveTextContent("30%");
  });
});
