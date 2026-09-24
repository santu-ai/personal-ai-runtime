import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import MemoriesPage from "./Memories";
import {
  ApiError,
  createMemory,
  getMemoryGraph,
  getMemoryProvenance,
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
    vi.mocked(getMemoryProvenance).mockResolvedValue({ memory_id: "m1", events: [] });
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

  it("closes the reject dialog on Escape and returns focus", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
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
      return { memories: [], total: 0 };
    });
    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const opener = await screen.findByRole("button", { name: "拒绝" });
    opener.focus();
    fireEvent.click(opener);
    const field = await screen.findByPlaceholderText("例如：记错了、过时了");
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "拒绝这条记忆？" })).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
    expect(rejectMemory).not.toHaveBeenCalled();
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

  it("keeps the memory list retry until the reread finishes", async () => {
    let release: ((row: { memories: []; total: number }) => void) | undefined;
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status) return { memories: [], total: 0 };
      throw new ApiError("加载失败", 500);
    });
    renderWithRouter(<MemoriesPage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status) return { memories: [], total: 0 };
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByTestId("memories-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText(/我还没有记住任何事/)).not.toBeInTheDocument();

    release?.({ memories: [], total: 0 });
    expect(await screen.findByText(/我还没有记住任何事/)).toBeInTheDocument();
    expect(screen.queryByTestId("memories-load-error")).not.toBeInTheDocument();
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

  function memoryItem(content: string): HTMLElement {
    const item = screen
      .getAllByText(content)
      .map((node) => node.closest("li"))
      .find((node): node is HTMLLIElement => node instanceof HTMLLIElement);
    if (!item) throw new Error(`missing memory row: ${content}`);
    return item;
  }

  it("keeps the provenance dialog and a retry when the chain fails to load", async () => {
    vi.mocked(getMemoryProvenance).mockRejectedValue(new ApiError("来源链暂时读不到", 503));
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    fireEvent.click(within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" }));

    const dialog = await screen.findByRole("dialog", { name: "记忆来源链" });
    const alert = await screen.findByTestId("memory-provenance-load-error");
    expect(alert).toHaveTextContent("来源链暂时读不到");
    expect(addError).toHaveBeenCalledWith("来源链暂时读不到", "记忆");
    expect(within(dialog).getByText("喜欢早起跑步")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(screen.queryByText("无事件记录")).not.toBeInTheDocument();
    expect(memoryItem("喜欢早起跑步")).toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("holds the provenance failure while that reread is in flight", async () => {
    vi.mocked(getMemoryProvenance).mockRejectedValueOnce(new ApiError("来源链暂时读不到", 503));
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    fireEvent.click(within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" }));
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    let release:
      | ((row: {
          memory_id: string;
          events: {
            seq: number;
            type: string;
            ts: string;
            actor: string;
            payload: { confidence: number };
            correlation_id: null;
          }[];
        }) => void)
      | undefined;
    vi.mocked(getMemoryProvenance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("memory-provenance-load-error")).toHaveTextContent(
      "来源链暂时读不到",
    );
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "记忆来源链" })).toBeInTheDocument();

    release?.({
      memory_id: "m1",
      events: [
        {
          seq: 1,
          type: "MemoryDerived",
          ts: "2026-09-01T00:00:00Z",
          actor: "brain",
          payload: { confidence: 0.9 },
          correlation_id: null,
        },
      ],
    });
    expect(await screen.findByText("由 brain 抽取，置信度 0.90")).toBeInTheDocument();
    expect(screen.queryByTestId("memory-provenance-load-error")).not.toBeInTheDocument();
  });

  it("uses the dialog fallback when provenance fails without a message", async () => {
    vi.mocked(getMemoryProvenance).mockRejectedValue(new Error("   "));
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    fireEvent.click(within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" }));
    expect(await screen.findByTestId("memory-provenance-load-error")).toHaveTextContent(
      "加载来源链失败",
    );
    expect(addError).toHaveBeenCalledWith("加载来源链失败", "记忆");
    expect(screen.getByRole("dialog", { name: "记忆来源链" })).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  it("drops the previous memory's provenance failure when another memory is opened", async () => {
    vi.mocked(listMemoriesGrouped).mockResolvedValue({
      memories: [
        { id: "m1", content: "喜欢早起跑步", confidence: 0.9, category: "habit" },
        { id: "m2", content: "住在上海", confidence: 0.8, category: "fact" },
      ],
      total: 2,
    });
    vi.mocked(getMemoryProvenance).mockImplementation(async (id: string) => {
      if (id === "m1") throw new ApiError("来源链暂时读不到", 503);
      return new Promise(() => {});
    });
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    fireEvent.click(within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" }));
    expect(await screen.findByTestId("memory-provenance-load-error")).toHaveTextContent(
      "来源链暂时读不到",
    );

    fireEvent.click(within(memoryItem("住在上海")).getByRole("button", { name: "来源" }));
    expect(await screen.findByText("加载中...")).toBeInTheDocument();
    expect(screen.queryByText("来源链暂时读不到")).not.toBeInTheDocument();
    expect(screen.queryByTestId("memory-provenance-load-error")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "记忆来源链" })).toHaveTextContent("住在上海");
    expect(memoryItem("喜欢早起跑步")).toBeInTheDocument();
  });

  it("shows an empty provenance chain after a successful read", async () => {
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    fireEvent.click(within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" }));
    expect(await screen.findByText("无事件记录")).toBeInTheDocument();
    expect(screen.queryByTestId("memory-provenance-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
  });

  it("returns focus to the source button when the provenance dialog closes", async () => {
    renderWithRouter(<MemoriesPage />);
    await screen.findByText("喜欢早起跑步");
    const opener = within(memoryItem("喜欢早起跑步")).getByRole("button", { name: "来源" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "记忆来源链" });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "记忆来源链" })).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });

  it("closes the edit dialog on Escape and returns focus", async () => {
    renderWithRouter(<MemoriesPage />);
    const opener = await screen.findByRole("button", { name: "编辑" });
    opener.focus();
    fireEvent.click(opener);
    const field = await screen.findByPlaceholderText("记忆内容");
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "编辑记忆" })).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });

  it("does not remember while an IME composition is confirming", async () => {
    renderWithRouter(<MemoriesPage />);
    const input = await screen.findByPlaceholderText("告诉我一件关于你的事，我会记住...");
    fireEvent.change(input, { target: { value: "喜欢喝茶" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(createMemory).not.toHaveBeenCalled();
    expect(input).toHaveValue("喜欢喝茶");
  });

  it("keeps the capture text when create fails, and ignores a second Enter while creating", async () => {
    vi.mocked(createMemory).mockRejectedValueOnce(new ApiError("创建记忆失败", 500));
    renderWithRouter(<MemoriesPage />);
    const input = await screen.findByPlaceholderText("告诉我一件关于你的事，我会记住...");
    fireEvent.change(input, { target: { value: "  喜欢喝茶  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建记忆失败", "记忆"));
    expect(createMemory).toHaveBeenCalledWith({ content: "喜欢喝茶", category: "fact" });
    expect(input).toHaveValue("  喜欢喝茶  ");
    expect(input).toBeEnabled();

    let release: (row: { id: string; status: string }) => void = () => {};
    vi.mocked(createMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "记住中..." })).toBeDisabled());
    expect(createMemory).toHaveBeenCalledTimes(2);

    release({ id: "m-new", status: "ok" });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toBeEnabled();
  });
});
