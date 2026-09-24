import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import MemoriesPage from "./Memories";
import {
  ApiError,
  getMemoryGraph,
  listMemoriesGrouped,
  ratifyMemory,
  rejectMemory,
} from "../api/client";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

vi.mock("../api/client", () => ({
  listMemoriesGrouped: vi.fn().mockResolvedValue({
    memories: [{ id: "m1", content: "喜欢早起跑步", confidence: 0.9, category: "habit" }],
    total: 1,
  }),
  countMemories: vi.fn().mockResolvedValue({ count: 0 }),
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  updateMemory: vi.fn(),
  ratifyMemory: vi.fn(),
  rejectMemory: vi.fn(),
  bulkClaimAction: vi.fn(),
  getClaimConversionStats: vi.fn().mockResolvedValue({
    days: 30,
    proposed_open: 1,
    ratified: 2,
    rejected: 1,
    auto_expired: 1,
    decided: 3,
    conversion_rate: 2 / 3,
    false_positive_rate: 1 / 3,
  }),
  getMemoryGraph: vi.fn(),
  getMemoryProvenance: vi.fn(),
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
  useErrorStore: (selector: (s: { addError: typeof addError }) => unknown) =>
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

describe("MemoriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemoriesGrouped).mockResolvedValue({
      memories: [{ id: "m1", content: "喜欢早起跑步", confidence: 0.9, category: "habit" }],
      total: 1,
    });
    vi.mocked(getMemoryGraph).mockResolvedValue({ nodes: [], edges: [] });
  });

  it("renders memories list", async () => {
    renderWithRouter(<MemoriesPage />);
    expect(await screen.findByText("AI 对你的理解")).toBeInTheDocument();
    expect(screen.getByText("喜欢早起跑步")).toBeInTheDocument();
  });

  it("shows conversion stats, rejected restore, and reject reason dialog", async () => {
    const mockList = vi.mocked(listMemoriesGrouped);
    mockList.mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "待确认的习惯",
              origin: "claim",
              claim_status: "proposed",
              confidence: 0.7,
            },
          ],
          total: 1,
        };
      }
      if (status === "rejected") {
        return {
          memories: [
            {
              id: "r1",
              content: "已拒绝的偏好",
              origin: "claim",
              claim_status: "rejected",
              reject_reason: "记错了",
            },
            {
              id: "r2",
              content: "过期的候选记忆",
              origin: "claim",
              claim_status: "rejected",
              reject_reason: "auto_expired",
            },
          ],
          total: 1,
        };
      }
      return { memories: [], total: 0 };
    });
    vi.mocked(ratifyMemory).mockResolvedValue({ status: "ok", claim_status: "ratified" });
    vi.mocked(rejectMemory).mockResolvedValue({ status: "ok", claim_status: "rejected" });

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });

    expect(await screen.findByTestId("claim-conversion-stats")).toHaveTextContent("转化率 67%");
    expect(screen.getByTestId("claim-conversion-stats")).toHaveTextContent("系统清理 1");
    expect(screen.getByText("已拒绝的偏好")).toBeInTheDocument();
    expect(screen.getByText("拒绝原因：记错了")).toBeInTheDocument();
    expect(screen.getByText("拒绝原因：已自动过期")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /恢复/ })[0]!);
    await waitFor(() => expect(ratifyMemory).toHaveBeenCalledWith("r1"));

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(await screen.findByText("拒绝这条记忆？")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如：记错了、过时了"), {
      target: { value: "过时了" },
    });
    const confirmReject = screen.getAllByRole("button", { name: "拒绝" }).slice(-1)[0];
    fireEvent.click(confirmReject!);
    await waitFor(() => expect(rejectMemory).toHaveBeenCalledWith("p1", "过时了"));
  });

  it("shows the empty memory list after a successful read", async () => {
    vi.mocked(listMemoriesGrouped).mockResolvedValue({ memories: [], total: 0 });
    renderWithRouter(<MemoriesPage />);
    expect(await screen.findByText(/我还没有记住任何事/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retry when the memory list fails to load", async () => {
    vi.mocked(listMemoriesGrouped).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<MemoriesPage />);
    const alert = await screen.findByTestId("memories-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "记忆");
    expect(screen.queryByText(/我还没有记住任何事/)).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("shows a retry when proposed memories fail to load", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") throw new ApiError("加载失败", 500);
      if (status === "rejected") throw new ApiError("拒绝列表失败", 500);
      return { memories: [], total: 0 };
    });
    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const alert = await screen.findByTestId("memories-review-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(screen.queryByText("没有待确认的记忆。")).not.toBeInTheDocument();
    const rejected = screen.getByTestId("memories-rejected-load-error");
    expect(rejected).toHaveTextContent("拒绝列表失败");
    expect(within(rejected).getByRole("button", { name: "重试" })).not.toHaveFocus();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("shows an empty graph after a successful read", async () => {
    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=graph"] });
    expect(await screen.findByText("暂无记忆数据可显示")).toBeInTheDocument();
    expect(screen.queryByTestId("memories-graph-load-error")).not.toBeInTheDocument();
  });

  it("shows a retry when the memory graph fails to load", async () => {
    vi.mocked(getMemoryGraph).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=graph"] });
    const alert = await screen.findByTestId("memories-graph-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(screen.queryByText("暂无记忆数据可显示")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });
});
