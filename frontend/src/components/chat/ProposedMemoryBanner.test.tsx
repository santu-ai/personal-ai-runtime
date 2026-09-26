import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import ProposedMemoryBanner, { proposedMemoryLayoutFocus } from "./ProposedMemoryBanner";
import {
  ApiError,
  countMemories,
  listMemoriesGrouped,
  ratifyMemory,
  rejectMemory,
} from "../../api/client";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

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
  useErrorStore: (selector: (s: { addError: typeof addError }) => unknown) =>
    selector({ addError }),
}));

const mockCount = vi.mocked(countMemories);
const mockList = vi.mocked(listMemoriesGrouped);
const mockRatify = vi.mocked(ratifyMemory);
const mockReject = vi.mocked(rejectMemory);

/** 这一条卸下的那一轮，绘制前焦点已经在下一处。useEffect 会先停在页面空白。 */
function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  proposedMemoryLayoutFocus.notify = () => {
    if (!gone()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
}

function row(id: string, content: string, createdAt: string) {
  return { id, content, created_at: createdAt };
}

describe("ProposedMemoryBanner", () => {
  beforeEach(() => {
    proposedMemoryLayoutFocus.notify = null;
    vi.clearAllMocks();
    addError.mockReset();
    mockCount.mockResolvedValue({ count: 2 });
    mockList.mockResolvedValue({
      memories: [
        { id: "m1", content: "喜欢早起跑步", confidence: 0.8 },
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

  it("queries only the current conversation when conversationId is set", async () => {
    mockCount.mockResolvedValue({ count: 1 });
    mockList.mockResolvedValue({
      memories: [{ id: "m1", content: "本对话事实", confidence: 0.8 }],
      total: 1,
    });
    renderWithRouter(<ProposedMemoryBanner conversationId="conv-a" />);
    await waitFor(() => {
      expect(mockCount).toHaveBeenCalledWith({
        claimStatus: "proposed",
        conversationId: "conv-a",
        source: undefined,
      });
    });
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        claimStatus: "proposed",
        conversationId: "conv-a",
      }),
    );
    expect(await screen.findByText(/1 条本对话记忆待确认后才会进入对话/)).toBeInTheDocument();
    expect(screen.getByText("本对话事实")).toBeInTheDocument();
  });

  it("writes the whole memory when keyboard focus is on 确认 or 拒绝", async () => {
    const content =
      "我每周一三五早上七点在公园跑步，跑完会喝一杯不加糖的美式，然后回到工位把这周要做的事写成可以勾掉的清单";
    mockList.mockResolvedValue({
      memories: [{ id: "m-long", content, confidence: 0.8 }],
      total: 1,
    });
    renderWithRouter(<ProposedMemoryBanner />);
    const text = await screen.findByTitle(content);
    expect(text).toHaveTextContent(content);
    expect(text).toHaveClass(
      "truncate",
      "group-has-[:focus-visible]:overflow-visible",
      "group-has-[:focus-visible]:whitespace-normal",
      "group-has-[:focus-visible]:text-clip",
    );
    expect(text.closest("li")).toHaveClass("group");
    expect(text.querySelector("[data-prompt-name]")).toBeNull();
  });

  it("shows items and ratifies inline", async () => {
    renderWithRouter(<ProposedMemoryBanner />);
    expect(await screen.findByText(/2 条记忆待确认后才会进入对话/)).toBeInTheDocument();
    expect(screen.getByText("喜欢早起跑步")).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
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

  it("does not confirm twice and keeps focus on the busy button", async () => {
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    mockRatify.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<ProposedMemoryBanner />);
    const [confirm] = await screen.findAllByRole("button", { name: "确认" });
    const row = confirm.closest("li");
    expect(row).not.toBeNull();
    const reject = within(row as HTMLElement).getByRole("button", { name: "拒绝" });
    confirm.focus();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(reject);
    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("aria-busy");
    expect(mockRatify).toHaveBeenCalledTimes(1);
    expect(mockReject).not.toHaveBeenCalled();

    release({ status: "ok", claim_status: "ratified" });
    await waitFor(() => expect(confirm).not.toHaveAttribute("aria-busy"));
  });

  it("still confirms another row while this one is in flight", async () => {
    const pending = new Map<string, (value: { status: string; claim_status: string }) => void>();
    mockRatify.mockImplementation(
      (id: string) =>
        new Promise((resolve) => {
          pending.set(id, resolve);
        }),
    );
    renderWithRouter(<ProposedMemoryBanner />);
    const [first, second] = await screen.findAllByRole("button", { name: "确认" });
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-busy", "true"));
    expect(mockRatify).toHaveBeenCalledTimes(2);
    expect(mockRatify).toHaveBeenNthCalledWith(1, "m1");
    expect(mockRatify).toHaveBeenNthCalledWith(2, "m2");
    expect(first).toHaveAttribute("aria-busy", "true");
    pending.get("m1")?.({ status: "ok", claim_status: "ratified" });
    pending.get("m2")?.({ status: "ok", claim_status: "ratified" });
    await waitFor(() => expect(first).not.toHaveAttribute("aria-busy"));
    expect(second).not.toHaveAttribute("aria-busy");
  });

  it("returns focus to confirm when ratify fails", async () => {
    mockRatify.mockRejectedValue(new ApiError("确认失败", 500));
    renderWithRouter(<ProposedMemoryBanner />);
    const confirm = (await screen.findAllByRole("button", { name: "确认" }))[0];
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("确认失败", "记忆"));
    expect(confirm).toHaveFocus();
    expect(confirm).toBeEnabled();
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(mockRatify).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the next confirm after this one leaves", async () => {
    let proposed = [
      row("m1", "喜欢早起跑步", "2026-09-24T02:00:00Z"),
      row("m2", "偏好绿茶", "2026-09-24T01:00:00Z"),
    ];
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockRatify.mockImplementation(async (id: string) => {
      proposed = proposed.filter((item) => item.id !== id);
      return { status: "ok", claim_status: "ratified" };
    });
    renderWithRouter(<ProposedMemoryBanner />);
    const [first] = await screen.findAllByRole("button", { name: "确认" });
    first.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("喜欢早起跑步"));
    fireEvent.click(first);
    await waitFor(() => expect(screen.getByRole("button", { name: "确认" })).toHaveFocus());
    expect(screen.getByText("偏好绿茶")).toBeInTheDocument();
    expect(screen.queryByText("喜欢早起跑步")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(screen.getByRole("button", { name: "确认" }));
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(mockRatify).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the previous reject when the last row leaves", async () => {
    let proposed = [
      row("m1", "喜欢早起跑步", "2026-09-24T02:00:00Z"),
      row("m2", "偏好绿茶", "2026-09-24T01:00:00Z"),
    ];
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockReject.mockImplementation(async (id: string) => {
      proposed = proposed.filter((item) => item.id !== id);
      return { status: "ok", claim_status: "rejected" };
    });
    renderWithRouter(<ProposedMemoryBanner />);
    const rejects = await screen.findAllByRole("button", { name: "拒绝" });
    rejects[1].focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("偏好绿茶"));
    fireEvent.click(rejects[1]);
    await waitFor(() => expect(screen.getByRole("button", { name: "拒绝" })).toHaveFocus());
    expect(screen.getByText("喜欢早起跑步")).toBeInTheDocument();
    expect(screen.queryByText("偏好绿茶")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(screen.getByRole("button", { name: "拒绝" }));
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("does not pull focus back when it already moved away", async () => {
    let proposed = [
      row("m1", "喜欢早起跑步", "2026-09-24T02:00:00Z"),
      row("m2", "偏好绿茶", "2026-09-24T01:00:00Z"),
    ];
    let release: (value: { status: string; claim_status: string }) => void = () => {};
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockRatify.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<ProposedMemoryBanner />);
    const [first] = await screen.findAllByRole("button", { name: "确认" });
    const review = screen.getByRole("link", { name: "查看全部" });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    review.focus();
    proposed = [proposed[1]];
    release({ status: "ok", claim_status: "ratified" });
    await waitFor(() => expect(screen.queryByText("喜欢早起跑步")).not.toBeInTheDocument());
    expect(review).toHaveFocus();
  });

  it("focuses review when no row remains but the banner stays", async () => {
    let proposed = [row("m1", "只剩这一条", "2026-09-24T02:00:00Z")];
    mockCount.mockResolvedValue({ count: 2 });
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockRatify.mockImplementation(async () => {
      proposed = [];
      return { status: "ok", claim_status: "ratified" };
    });
    renderWithRouter(
      <>
        <ProposedMemoryBanner />
        <textarea data-chat-composer="" aria-label="输入消息" />
      </>,
    );
    const confirm = await screen.findByRole("button", { name: "确认" });
    confirm.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("只剩这一条"));
    fireEvent.click(confirm);
    const review = screen.getByRole("link", { name: "查看全部" });
    await waitFor(() => expect(review).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "输入消息" })).not.toHaveFocus();
    expect(focusWhenGone.read()).toBe(review);
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("focuses the composer when the banner closes after the last confirm", async () => {
    let proposed = [row("m1", "只剩这一条", "2026-09-24T02:00:00Z")];
    mockCount.mockImplementation(async () => ({ count: proposed.length }));
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockRatify.mockImplementation(async () => {
      proposed = [];
      return { status: "ok", claim_status: "ratified" };
    });
    renderWithRouter(
      <>
        <ProposedMemoryBanner />
        <textarea data-chat-composer="" aria-label="输入消息" />
      </>,
    );
    const confirm = await screen.findByRole("button", { name: "确认" });
    const composer = screen.getByRole("textbox", { name: "输入消息" });
    confirm.focus();
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("link", { name: "查看全部" }),
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(composer).toHaveFocus());
    expect(screen.queryByText("只剩这一条")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看全部" })).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(composer);
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("does not focus a disabled composer when the banner closes", async () => {
    let proposed = [row("m1", "只剩这一条", "2026-09-24T02:00:00Z")];
    mockCount.mockImplementation(async () => ({ count: proposed.length }));
    mockList.mockImplementation(async () => ({ memories: proposed, total: proposed.length }));
    mockRatify.mockImplementation(async () => {
      proposed = [];
      return { status: "ok", claim_status: "ratified" };
    });
    renderWithRouter(
      <>
        <ProposedMemoryBanner />
        <textarea data-chat-composer="" aria-label="输入消息" disabled />
      </>,
    );
    const confirm = await screen.findByRole("button", { name: "确认" });
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByText("只剩这一条")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "输入消息" })).not.toHaveFocus();
  });
});
