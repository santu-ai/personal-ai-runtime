import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import TasksPage from "./Tasks";

vi.mock("../api/client", () => ({
  listWorkItems: vi.fn().mockResolvedValue([]),
  getWorkItem: vi.fn(),
  executeWorkItem: vi.fn(),
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

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty tasks shell", async () => {
    renderWithRouter(<TasksPage />, { initialEntries: ["/tasks"] });
    expect(await screen.findByText("暂无任务")).toBeInTheDocument();
    expect(screen.getByText("后台与可执行任务")).toBeInTheDocument();
  });
});
