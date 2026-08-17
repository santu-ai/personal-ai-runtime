import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import ProposedMemoryBanner from "./ProposedMemoryBanner";
import { countMemories, listMemoriesGrouped, ratifyMemory, rejectMemory } from "../../api/client";

vi.mock("../../api/client", () => ({
  countMemories: vi.fn(),
  listMemoriesGrouped: vi.fn(),
  ratifyMemory: vi.fn(),
  rejectMemory: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
}));

const mockCount = vi.mocked(countMemories);
const mockList = vi.mocked(listMemoriesGrouped);
const mockRatify = vi.mocked(ratifyMemory);
const mockReject = vi.mocked(rejectMemory);

describe("ProposedMemoryBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCount.mockResolvedValue({ count: 2 });
    mockList.mockResolvedValue({
      memories: [
        { id: "m1", content: "喜欢早起跑步" },
        { id: "m2", content: "偏好绿茶" },
      ],
      total: 2,
    });
    mockRatify.mockResolvedValue({ status: "ok", claim_status: "ratified" });
    mockReject.mockResolvedValue({ status: "ok", claim_status: "rejected" });
  });

  it("renders nothing when count is zero", async () => {
    mockCount.mockResolvedValue({ count: 0 });
    renderWithRouter(<ProposedMemoryBanner />);
    await waitFor(() => expect(mockCount).toHaveBeenCalled());
    expect(screen.queryByText(/待确认后才会进入对话/)).not.toBeInTheDocument();
  });

  it("shows items and ratifies inline", async () => {
    renderWithRouter(<ProposedMemoryBanner />);
    expect(await screen.findByText(/2 条记忆待确认后才会进入对话/)).toBeInTheDocument();
    expect(screen.getByText("喜欢早起跑步")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "确认" })[0]);
    await waitFor(() => expect(mockRatify).toHaveBeenCalledWith("m1"));
  });

  it("rejects inline", async () => {
    renderWithRouter(<ProposedMemoryBanner />);
    expect(await screen.findByText("偏好绿茶")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "拒绝" })[1]);
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith("m2"));
  });

  it("links to the review tab", async () => {
    renderWithRouter(<ProposedMemoryBanner />);
    const link = await screen.findByRole("link", { name: "查看全部" });
    expect(link).toHaveAttribute("href", "/memories?tab=review");
  });
});
