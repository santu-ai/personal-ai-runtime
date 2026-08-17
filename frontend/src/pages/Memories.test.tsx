import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import MemoriesPage from "./Memories";
import { listMemoriesGrouped, ratifyMemory, rejectMemory } from "../api/client";

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

describe("MemoriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByText("已拒绝的偏好")).toBeInTheDocument();
    expect(screen.getByText("拒绝原因：记错了")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /恢复/ }));
    await waitFor(() => expect(ratifyMemory).toHaveBeenCalledWith("r1"));

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(await screen.findByText("拒绝这条记忆？")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如：记错了、过时了"), {
      target: { value: "过时了" },
    });
    const confirmReject = screen.getAllByRole("button", { name: "拒绝" }).at(-1);
    fireEvent.click(confirmReject!);
    await waitFor(() => expect(rejectMemory).toHaveBeenCalledWith("p1", "过时了"));
  });
});
