import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import MemoriesPage from "./Memories";
import {
  ApiError,
  createConversation,
  type Conversation,
  createMemory,
  deleteMemory,
  getMemoryGraph,
  getMemoryProvenance,
  listMemoriesGrouped,
  bulkClaimAction,
  ratifyMemory,
  rejectMemory,
  updateMemory,
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

vi.mock("../stores/chatStore", () => {
  const state = {
    conversations: [] as { id: string }[],
    addConversation: vi.fn(),
    setActiveConversation: vi.fn(),
    setPendingPrompt: vi.fn(),
    setConversations: vi.fn(),
  };
  return {
    useChatStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

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
    input.focus();
    fireEvent.change(input, { target: { value: "  喜欢喝茶  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建记忆失败", "记忆"));
    expect(createMemory).toHaveBeenCalledWith({ content: "喜欢喝茶", category: "fact" });
    expect(input).toHaveValue("  喜欢喝茶  ");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();

    let release: (row: { id: string; status: string }) => void = () => {};
    vi.mocked(createMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    const pending = await screen.findByRole("button", { name: "记住中..." });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toBeEnabled();
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
    fireEvent.click(pending);
    expect(createMemory).toHaveBeenCalledTimes(2);

    release({ id: "m-new", status: "ok" });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("moves focus to the capture field after remember succeeds from the button", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    vi.mocked(createMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<MemoriesPage />);
    const input = await screen.findByPlaceholderText("告诉我一件关于你的事，我会记住...");
    fireEvent.change(input, { target: { value: "喜欢喝茶" } });
    const remember = screen.getByRole("button", { name: "记住" });
    remember.focus();
    fireEvent.click(remember);
    const pending = await screen.findByRole("button", { name: "记住中..." });
    expect(pending).toHaveFocus();
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release({ id: "m-new", status: "ok" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("");
    expect(createMemory).toHaveBeenCalledTimes(1);
  });

  it("keeps text typed during remember and does not pull focus back", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    vi.mocked(createMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<MemoriesPage />);
    const input = await screen.findByPlaceholderText("告诉我一件关于你的事，我会记住...");
    input.focus();
    fireEvent.change(input, { target: { value: "喜欢喝茶" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "记住中..." });
    fireEvent.change(input, { target: { value: "喜欢喝茶，也喜欢咖啡" } });
    const edit = screen.getByRole("button", { name: "编辑" });
    edit.focus();

    release({ id: "m-new", status: "ok" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "记住中..." })).not.toBeInTheDocument(),
    );
    expect(input).toHaveValue("喜欢喝茶，也喜欢咖啡");
    expect(edit).toHaveFocus();
    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory).toHaveBeenCalledWith({ content: "喜欢喝茶", category: "fact" });
  });

  it("keeps the reject reason when reject fails and does not send or close again while it is in flight", async () => {
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
    let fail: (err: unknown) => void = () => {};
    vi.mocked(rejectMemory).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("button", { name: "拒绝" }));
    const dialog = await screen.findByRole("dialog", { name: "拒绝这条记忆？" });
    const field = within(dialog).getByPlaceholderText("例如：记错了、过时了");
    fireEvent.change(field, { target: { value: "  过时了  " } });
    const reject = within(dialog).getByRole("button", { name: "拒绝" });
    reject.focus();
    fireEvent.click(reject);
    fireEvent.click(within(dialog).getByRole("button", { name: "拒绝中..." }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const pending = await within(dialog).findByRole("button", { name: "拒绝中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(field).toHaveValue("  过时了  ");
    expect(field).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(rejectMemory).toHaveBeenCalledTimes(1);
    expect(rejectMemory).toHaveBeenCalledWith("p1", "过时了");
    expect(dialog).toBeInTheDocument();

    fail(new ApiError("拒绝记忆失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("拒绝记忆失败", "记忆"));
    expect(dialog).toBeInTheDocument();
    expect(field).toHaveValue("  过时了  ");
    expect(field).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "拒绝" })).toHaveFocus();

    vi.mocked(rejectMemory).mockResolvedValueOnce({ status: "ok", claim_status: "rejected" });
    fireEvent.click(within(dialog).getByRole("button", { name: "拒绝" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "拒绝这条记忆？" })).not.toBeInTheDocument(),
    );
    expect(rejectMemory).toHaveBeenCalledTimes(2);
  });

  it("keeps the edited memory when save fails and ignores a second click while saving", async () => {
    let fail: (err: unknown) => void = () => {};
    vi.mocked(updateMemory).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<MemoriesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑记忆" });
    const content = within(dialog).getByPlaceholderText("记忆内容");
    const category = within(dialog).getByPlaceholderText("如 fact, preference, habit");
    fireEvent.change(content, { target: { value: "  改为夜跑  " } });
    fireEvent.change(category, { target: { value: "habit" } });
    const save = within(dialog).getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存中..." }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const pending = await within(dialog).findByRole("button", { name: "保存中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(content).toHaveValue("  改为夜跑  ");
    expect(category).toHaveValue("habit");
    expect(content).toBeEnabled();
    expect(category).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(updateMemory).toHaveBeenCalledTimes(1);
    expect(updateMemory).toHaveBeenCalledWith("m1", { content: "改为夜跑", category: "habit" });
    expect(dialog).toBeInTheDocument();

    fail(new ApiError("更新记忆失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("更新记忆失败", "记忆"));
    expect(dialog).toBeInTheDocument();
    expect(content).toHaveValue("  改为夜跑  ");
    expect(category).toHaveValue("habit");
    expect(content).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "保存" })).toHaveFocus();

    vi.mocked(updateMemory).mockResolvedValueOnce({ status: "ok" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "编辑记忆" })).not.toBeInTheDocument(),
    );
    expect(updateMemory).toHaveBeenCalledTimes(2);
  });

  it("keeps a reject reason typed during the request and does not pull focus back", async () => {
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
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    vi.mocked(rejectMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const open = await screen.findByRole("button", { name: "拒绝" });
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog", { name: "拒绝这条记忆？" });
    const field = within(dialog).getByPlaceholderText("例如：记错了、过时了");
    fireEvent.change(field, { target: { value: "过时了" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "拒绝" }));
    await within(dialog).findByRole("button", { name: "拒绝中..." });
    field.focus();
    fireEvent.change(field, { target: { value: "过时了，再补一句" } });
    open.focus();

    release({ status: "ok", claim_status: "rejected" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "拒绝中..." })).not.toBeInTheDocument(),
    );
    expect(dialog).toBeInTheDocument();
    expect(field).toHaveValue("过时了，再补一句");
    expect(open).toHaveFocus();
    expect(rejectMemory).toHaveBeenCalledTimes(1);
    expect(rejectMemory).toHaveBeenCalledWith("p1", "过时了");
  });

  it("moves focus to the reject reason when the draft changed and focus is still on the button", async () => {
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
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    vi.mocked(rejectMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("button", { name: "拒绝" }));
    const dialog = await screen.findByRole("dialog", { name: "拒绝这条记忆？" });
    const field = within(dialog).getByPlaceholderText("例如：记错了、过时了");
    fireEvent.change(field, { target: { value: "过时了" } });
    const reject = within(dialog).getByRole("button", { name: "拒绝" });
    reject.focus();
    fireEvent.click(reject);
    await within(dialog).findByRole("button", { name: "拒绝中..." });
    fireEvent.change(field, { target: { value: "过时了，再补一句" } });

    release({ status: "ok", claim_status: "rejected" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(dialog).toBeInTheDocument();
    expect(field).toHaveValue("过时了，再补一句");
    expect(rejectMemory).toHaveBeenCalledTimes(1);
  });

  it("keeps an edit typed during save and does not pull focus back", async () => {
    let release: (value: { status: string }) => void = () => {};
    vi.mocked(updateMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />);
    const open = await screen.findByRole("button", { name: "编辑" });
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog", { name: "编辑记忆" });
    const content = within(dialog).getByPlaceholderText("记忆内容");
    const category = within(dialog).getByPlaceholderText("如 fact, preference, habit");
    fireEvent.change(content, { target: { value: "改为夜跑" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await within(dialog).findByRole("button", { name: "保存中..." });
    content.focus();
    fireEvent.change(content, { target: { value: "改为夜跑，再补距离" } });
    fireEvent.change(category, { target: { value: "preference" } });
    open.focus();

    release({ status: "ok" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "保存中..." })).not.toBeInTheDocument(),
    );
    expect(dialog).toBeInTheDocument();
    expect(content).toHaveValue("改为夜跑，再补距离");
    expect(category).toHaveValue("preference");
    expect(open).toHaveFocus();
    expect(updateMemory).toHaveBeenCalledTimes(1);
    expect(updateMemory).toHaveBeenCalledWith("m1", { content: "改为夜跑", category: "habit" });
  });

  it("moves focus to the memory content when the edit changed and focus is still on save", async () => {
    let release: (value: { status: string }) => void = () => {};
    vi.mocked(updateMemory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑记忆" });
    const content = within(dialog).getByPlaceholderText("记忆内容");
    fireEvent.change(content, { target: { value: "改为夜跑" } });
    const save = within(dialog).getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    await within(dialog).findByRole("button", { name: "保存中..." });
    fireEvent.change(content, { target: { value: "改为夜跑，再补距离" } });

    release({ status: "ok" });
    await waitFor(() => expect(content).toHaveFocus());
    expect(dialog).toBeInTheDocument();
    expect(content).toHaveValue("改为夜跑，再补距离");
    expect(updateMemory).toHaveBeenCalledTimes(1);
  });

  it("keeps the forget dialog open until delete succeeds and ignores Escape while deleting", async () => {
    let fail: (err: unknown) => void = () => {};
    vi.mocked(deleteMemory).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<MemoriesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "忘掉" }));
    const dialog = await screen.findByRole("dialog", { name: "忘掉这条记忆？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "忘掉" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "忘掉中..." }));
    fireEvent.keyDown(window, { key: "Escape" });

    const pending = await within(dialog).findByRole("button", { name: "忘掉中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(deleteMemory).toHaveBeenCalledTimes(1);
    expect(deleteMemory).toHaveBeenCalledWith("m1");
    expect(dialog).toBeInTheDocument();

    fail(new ApiError("删除记忆失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("删除记忆失败", "记忆"));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "忘掉" })).toBeEnabled();

    vi.mocked(deleteMemory).mockResolvedValueOnce({ status: "ok" });
    fireEvent.click(within(dialog).getByRole("button", { name: "忘掉" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "忘掉这条记忆？" })).not.toBeInTheDocument(),
    );
    expect(deleteMemory).toHaveBeenCalledTimes(2);
  });

  it("does not ratify twice and moves focus to the next proposed row", async () => {
    let proposed = [
      {
        id: "p1",
        content: "第一条",
        origin: "claim" as const,
        claim_status: "proposed" as const,
        created_at: "2026-09-24T02:00:00Z",
      },
      {
        id: "p2",
        content: "第二条",
        origin: "claim" as const,
        claim_status: "proposed" as const,
        created_at: "2026-09-24T01:00:00Z",
      },
    ];
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") return { memories: proposed, total: proposed.length };
      return { memories: [], total: 0 };
    });
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    vi.mocked(ratifyMemory).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const [first] = await screen.findAllByRole("button", { name: "确认" });
    expect(screen.getAllByRole("button", { name: "确认" })).toHaveLength(2);
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    expect(first).toBeEnabled();
    expect(first).toHaveFocus();
    const reject = within(screen.getByText("第一条").closest("li")!).getByRole("button", {
      name: "拒绝",
    });
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("aria-busy");
    const second = screen.getAllByRole("button", { name: "确认" })[1];
    expect(second).toBeEnabled();
    expect(second).not.toHaveAttribute("aria-busy");
    fireEvent.click(reject);
    expect(screen.queryByRole("dialog", { name: "拒绝这条记忆？" })).not.toBeInTheDocument();
    expect(ratifyMemory).toHaveBeenCalledTimes(1);

    proposed = [proposed[1]];
    release({ status: "ok", claim_status: "ratified" });
    await waitFor(() => expect(screen.getByRole("button", { name: "确认" })).toHaveFocus());
    expect(screen.getByText("第二条")).toBeInTheDocument();
    expect(screen.queryByText("第一条")).not.toBeInTheDocument();
    expect(ratifyMemory).toHaveBeenCalledWith("p1");
  });

  it("returns focus to confirm when ratify fails", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "第一条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T02:00:00Z",
            },
          ],
          total: 1,
        };
      }
      return { memories: [], total: 0 };
    });
    let fail: (err: unknown) => void = () => {};
    vi.mocked(ratifyMemory).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const confirm = await screen.findByRole("button", { name: "确认" });
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    fail(new ApiError("确认失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("确认失败", "记忆"));
    expect(confirm).toHaveFocus();
    expect(confirm).toBeEnabled();
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(ratifyMemory).toHaveBeenCalledTimes(1);
  });

  it("does not pull focus back when it already moved to another row", async () => {
    let proposed = [
      {
        id: "p1",
        content: "第一条",
        origin: "claim" as const,
        claim_status: "proposed" as const,
        created_at: "2026-09-24T02:00:00Z",
      },
      {
        id: "p2",
        content: "第二条",
        origin: "claim" as const,
        claim_status: "proposed" as const,
        created_at: "2026-09-24T01:00:00Z",
      },
    ];
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") return { memories: proposed, total: proposed.length };
      return { memories: [], total: 0 };
    });
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    vi.mocked(ratifyMemory).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const [first, second] = await screen.findAllByRole("button", { name: "确认" });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    second.focus();
    proposed = [proposed[1]];
    release({ status: "ok", claim_status: "ratified" });
    await waitFor(() => expect(screen.queryByText("第一条")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "确认" })).toHaveFocus();
  });

  it("returns to the review tab after the last confirm leaves", async () => {
    let proposed = [
      {
        id: "p1",
        content: "只剩这一条",
        origin: "claim" as const,
        claim_status: "proposed" as const,
        created_at: "2026-09-24T02:00:00Z",
      },
    ];
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") return { memories: proposed, total: proposed.length };
      return { memories: [], total: 0 };
    });
    vi.mocked(ratifyMemory).mockImplementation(async () => {
      proposed = [];
      return { status: "ok", claim_status: "ratified" };
    });

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "待确认" })).toHaveFocus());
    expect(screen.getByText("没有待确认的记忆。")).toBeInTheDocument();
  });

  it("moves focus to the next restore button", async () => {
    let rejected = [
      {
        id: "r1",
        content: "先恢复这条",
        origin: "claim" as const,
        claim_status: "rejected" as const,
        reject_reason: "记错了",
        created_at: "2026-09-24T02:00:00Z",
      },
      {
        id: "r2",
        content: "下一条拒绝",
        origin: "claim" as const,
        claim_status: "rejected" as const,
        reject_reason: "过时了",
        created_at: "2026-09-24T01:00:00Z",
      },
    ];
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "rejected") return { memories: rejected, total: rejected.length };
      return { memories: [], total: 0 };
    });
    vi.mocked(ratifyMemory).mockImplementation(async () => {
      rejected = [rejected[1]];
      return { status: "ok", claim_status: "ratified" };
    });

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const [first, second] = await screen.findAllByRole("button", { name: "恢复" });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(second).toHaveFocus());
    expect(screen.queryByText("先恢复这条")).not.toBeInTheDocument();
    expect(ratifyMemory).toHaveBeenCalledTimes(1);
    expect(ratifyMemory).toHaveBeenCalledWith("r1");
  });

  it("returns to the capture field after the last list confirm leaves", async () => {
    let rows: Array<{
      id: string;
      content: string;
      origin: "claim";
      claim_status: "proposed" | "ratified";
      category: string;
      created_at: string;
    }> = [
      {
        id: "p1",
        content: "列表里的一条",
        origin: "claim",
        claim_status: "proposed",
        category: "habit",
        created_at: "2026-09-24T02:00:00Z",
      },
    ];
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status) return { memories: [], total: 0 };
      return { memories: rows, total: rows.length };
    });
    vi.mocked(ratifyMemory).mockImplementation(async () => {
      rows = [{ ...rows[0], claim_status: "ratified" }];
      return { status: "ok", claim_status: "ratified" };
    });

    renderWithRouter(<MemoriesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("告诉我一件关于你的事，我会记住...")).toHaveFocus(),
    );
    expect(screen.queryByRole("button", { name: "确认" })).not.toBeInTheDocument();
  });

  it("does not send bulk confirm twice", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "第一条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T02:00:00Z",
            },
          ],
          total: 1,
        };
      }
      return { memories: [], total: 0 };
    });
    let release: (value: {
      status: string;
      action: string;
      ok: number;
      skipped: Array<{ id: string; reason: string }>;
    }) => void = () => {};
    vi.mocked(bulkClaimAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /全选当前页/ }));
    const bulk = screen.getByRole("button", { name: /批量确认/ });
    bulk.focus();
    fireEvent.click(bulk);
    fireEvent.click(bulk);
    await waitFor(() => expect(bulk).toHaveAttribute("aria-busy", "true"));
    expect(bulk).toBeEnabled();
    expect(bulk).toHaveFocus();
    const other = screen.getByRole("button", { name: /批量拒绝/ });
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");
    fireEvent.click(other);
    expect(bulkClaimAction).toHaveBeenCalledTimes(1);
    expect(bulkClaimAction).toHaveBeenCalledWith("ratify", ["p1"]);
    release({ status: "ok", action: "ratify", ok: 1, skipped: [] });
    await waitFor(() => expect(screen.getByRole("tab", { name: "待确认" })).toHaveFocus());
    expect(bulk).not.toHaveAttribute("aria-busy");
    expect(bulk).toBeDisabled();
  });

  it("keeps bulk confirm focus when it fails and does not clear the selection", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "第一条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T02:00:00Z",
            },
          ],
          total: 1,
        };
      }
      return { memories: [], total: 0 };
    });
    let fail: (err: unknown) => void = () => {};
    vi.mocked(bulkClaimAction).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /全选当前页/ }));
    const bulk = screen.getByRole("button", { name: /批量确认/ });
    bulk.focus();
    fireEvent.click(bulk);
    await waitFor(() => expect(bulk).toHaveAttribute("aria-busy", "true"));
    expect(bulk).toBeEnabled();
    expect(bulk).toHaveFocus();
    fail(new ApiError("批量确认失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("批量确认失败", "记忆"));
    expect(bulk).toHaveFocus();
    expect(bulk).toBeEnabled();
    expect(bulk).not.toHaveAttribute("aria-busy");
    expect(bulk).toHaveTextContent("批量确认（1）");
    expect(bulkClaimAction).toHaveBeenCalledTimes(1);
  });

  it("moves bulk confirm focus to a row that was not in this batch", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "第一条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T02:00:00Z",
            },
            {
              id: "p2",
              content: "第二条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T01:00:00Z",
            },
          ],
          total: 2,
        };
      }
      return { memories: [], total: 0 };
    });
    let release: (value: {
      status: string;
      action: string;
      ok: number;
      skipped: Array<{ id: string; reason: string }>;
    }) => void = () => {};
    vi.mocked(bulkClaimAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    const row = (await screen.findByText("第一条")).closest("li");
    fireEvent.click(within(row!).getByRole("checkbox"));
    const bulk = screen.getByRole("button", { name: "批量确认（1）" });
    bulk.focus();
    fireEvent.click(bulk);
    await waitFor(() => expect(bulk).toHaveAttribute("aria-busy", "true"));
    expect(bulk).toHaveFocus();
    release({ status: "ok", action: "ratify", ok: 1, skipped: [] });
    const next = within(screen.getByText("第二条").closest("li")!).getByRole("button", {
      name: "确认",
    });
    await waitFor(() => expect(next).toHaveFocus());
    expect(screen.getByRole("tab", { name: "待确认" })).not.toHaveFocus();
  });

  it("does not pull bulk confirm focus back when it already moved", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async (opts) => {
      const status = typeof opts === "string" ? opts : opts?.claimStatus;
      if (status === "proposed") {
        return {
          memories: [
            {
              id: "p1",
              content: "第一条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T02:00:00Z",
            },
            {
              id: "p2",
              content: "第二条",
              origin: "claim",
              claim_status: "proposed",
              created_at: "2026-09-24T01:00:00Z",
            },
          ],
          total: 2,
        };
      }
      return { memories: [], total: 0 };
    });
    let release: (value: {
      status: string;
      action: string;
      ok: number;
      skipped: Array<{ id: string; reason: string }>;
    }) => void = () => {};
    vi.mocked(bulkClaimAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderWithRouter(<MemoriesPage />, { initialEntries: ["/memories?tab=review"] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /全选当前页/ }));
    const bulk = screen.getByRole("button", { name: /批量确认/ });
    const kept = within(screen.getByText("第二条").closest("li")!).getByRole("button", {
      name: "确认",
    });
    bulk.focus();
    fireEvent.click(bulk);
    await waitFor(() => expect(bulk).toHaveAttribute("aria-busy", "true"));
    kept.focus();
    release({ status: "ok", action: "ratify", ok: 2, skipped: [] });
    await waitFor(() => expect(bulk).not.toHaveAttribute("aria-busy"));
    expect(kept).toHaveFocus();
  });

  it("does not open a second chat while 继续聊 is in flight", async () => {
    vi.mocked(listMemoriesGrouped).mockImplementation(async () => ({
      memories: [
        { id: "m1", content: "喜欢早起跑步", confidence: 0.9, category: "habit" },
        { id: "m2", content: "晚上喝茶", confidence: 0.8, category: "habit" },
      ],
      total: 2,
    }));
    let release: (conv: Conversation) => void = () => {};
    vi.mocked(createConversation).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<MemoriesPage />);
    const first = within(
      (await screen.findByText("喜欢早起跑步")).closest("li") as HTMLElement,
    ).getByRole("button", { name: "继续聊" });
    const second = within(screen.getByText("晚上喝茶").closest("li") as HTMLElement).getByRole(
      "button",
      { name: "继续聊" },
    );
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(second);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    expect(first).toBeEnabled();
    expect(first).toHaveFocus();
    expect(first).toHaveClass("opacity-50");
    expect(second).toBeEnabled();
    expect(second).not.toHaveAttribute("aria-busy");
    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(createConversation).toHaveBeenCalledWith("记忆讨论");

    const capture = screen.getByPlaceholderText("告诉我一件关于你的事，我会记住...");
    capture.focus();
    await act(async () => {
      release({ id: "c-mem", title: "记忆讨论" } as Conversation);
    });
    await waitFor(() => expect(first).not.toHaveAttribute("aria-busy"));
    expect(capture).toHaveFocus();
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it("returns focus to 继续聊 when opening the chat fails, and does not steal it", async () => {
    vi.mocked(listMemoriesGrouped).mockResolvedValue({
      memories: [{ id: "m1", content: "喜欢早起跑步", confidence: 0.9, category: "habit" }],
      total: 1,
    });
    vi.mocked(createConversation).mockRejectedValue(new ApiError("创建对话失败", 500));
    renderWithRouter(<MemoriesPage />);
    const chat = within(
      (await screen.findByText("喜欢早起跑步")).closest("li") as HTMLElement,
    ).getByRole("button", { name: "继续聊" });
    chat.focus();
    fireEvent.click(chat);
    fireEvent.click(chat);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建对话失败", "对话"));
    expect(chat).toHaveFocus();
    expect(chat).toBeEnabled();
    expect(chat).not.toHaveAttribute("aria-busy");
    expect(createConversation).toHaveBeenCalledTimes(1);

    let release: (err: unknown) => void = () => {};
    vi.mocked(createConversation).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          release = reject;
        }),
    );
    fireEvent.click(chat);
    await waitFor(() => expect(chat).toHaveAttribute("aria-busy", "true"));
    (chat as HTMLButtonElement).blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      release(new ApiError("创建对话失败", 500));
    });
    await waitFor(() => expect(chat).not.toHaveAttribute("aria-busy"));
    expect(chat).toHaveFocus();

    const capture = screen.getByPlaceholderText("告诉我一件关于你的事，我会记住...");
    fireEvent.click(chat);
    await waitFor(() => expect(chat).toHaveAttribute("aria-busy", "true"));
    capture.focus();
    await act(async () => {
      release(new ApiError("创建对话失败", 500));
    });
    await waitFor(() => expect(chat).not.toHaveAttribute("aria-busy"));
    expect(capture).toHaveFocus();
    expect(createConversation).toHaveBeenCalledTimes(3);
  });
});
