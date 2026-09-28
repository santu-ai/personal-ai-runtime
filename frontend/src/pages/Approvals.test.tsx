import { queryAnnouncement, findAnnouncement } from "../test/liveStatus";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter, MockApiError } from "../test-utils";
import ApprovalsPage, { approvalPageLayoutFocus } from "./Approvals";
import type { EnrichedApproval } from "../api/client";

const { addError, mockNavigate } = vi.hoisted(() => ({
  addError: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listEnrichedPendingApprovals: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  resolveApproval: vi.fn(),
  getCapabilityPolicy: vi.fn().mockResolvedValue({
    auto_allow: ["read_file"],
    needs_user: ["write_file", "send_email"],
    forbidden: ["shell_exec"],
    external_ingestion: [],
  }),
  ApiError: MockApiError,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addError }),
}));

import {
  listEnrichedPendingApprovals,
  approveApproval,
  rejectApproval,
  resolveApproval,
} from "../api/client";

const mockList = vi.mocked(listEnrichedPendingApprovals);
const mockApprove = vi.mocked(approveApproval);
const mockReject = vi.mocked(rejectApproval);
const mockResolve = vi.mocked(resolveApproval);

/** 最后一张卸下的那一轮，绘制前焦点已经在「刷新」上。useEffect 会先停在页面空白。 */
function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  approvalPageLayoutFocus.notify = () => {
    if (!gone()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
}

const sampleApproval: EnrichedApproval = {
  id: "ap-1",
  action: "write_file",
  status: "pending",
  params: JSON.stringify({ path: "/tmp/test.txt" }),
  created_at: new Date().toISOString(),
  flow_type: "对话",
  flow_label: "测试对话",
  correlation_id: "corr-1",
};

const chatContinuable: EnrichedApproval = {
  ...sampleApproval,
  id: "ap-2",
  conversation_id: "conv-9",
  tool_call_id: "tc-9",
};

describe("ApprovalsPage", () => {
  beforeEach(() => {
    approvalPageLayoutFocus.notify = null;
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  it("shows loading state initially", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ApprovalsPage />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows empty state when no approvals", async () => {
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => {
      expect(screen.getByText("暂无待审批项")).toBeInTheDocument();
    });
    expect(screen.getByText("所有高风险操作已处理完毕")).toBeInTheDocument();
    expect(queryAnnouncement()).not.toBeInTheDocument();
  });

  it("renders approval list", async () => {
    mockList.mockResolvedValue([sampleApproval]);
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => {
      expect(screen.getByText("写入文件")).toBeInTheDocument();
      expect(screen.getByText("1 条待处理")).toBeInTheDocument();
    });
  });

  it("removes item after approve", async () => {
    mockList.mockResolvedValueOnce([sampleApproval]).mockResolvedValue([]);
    mockApprove.mockResolvedValue({ id: "ap-1", status: "approved" });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText("批准")).toBeInTheDocument());
    fireEvent.click(screen.getByText("批准"));
    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith("ap-1");
      expect(screen.getByText("暂无待审批项")).toBeInTheDocument();
    });
  });

  it("removes item after reject", async () => {
    mockList.mockResolvedValueOnce([sampleApproval]).mockResolvedValue([]);
    mockReject.mockResolvedValue({ id: "ap-1", status: "rejected" });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText("拒绝")).toBeInTheDocument());
    fireEvent.click(screen.getByText("拒绝"));
    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith("ap-1", "手动拒绝");
      expect(screen.getByText("暂无待审批项")).toBeInTheDocument();
    });
  });

  it("calls addError when load fails", async () => {
    mockList.mockRejectedValue(new MockApiError("加载失败", 500));
    const focusWhenShown = captureFocusWhenGone(
      () => screen.queryByRole("button", { name: /^重试(：|$)/ }) !== null,
    );
    renderWithRouter(<ApprovalsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "审批");
    expect(screen.getByRole("heading", { name: "审批管理" })).toBeInTheDocument();
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();
    expect(screen.queryByText("所有高风险操作已处理完毕")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: /^重试(：|$)/ });
    expect(retry).toHaveAttribute("aria-label", "重试：加载失败");
    expect(retry).toHaveTextContent("重试");
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    expect(retry).toHaveFocus();
    expect(focusWhenShown.read()).toBe(retry);
    expect(focusWhenShown.read()).not.toBe(document.body);
  });

  it("uses the page fallback when the load error has no message", async () => {
    mockList.mockRejectedValue(new MockApiError("   ", 500));
    renderWithRouter(<ApprovalsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("加载审批列表失败");
    expect(addError).toHaveBeenCalledWith("加载审批列表失败", "审批");
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();
  });

  it("keeps retry mounted until the reread finishes, then shows the empty queue", async () => {
    let release: ((rows: EnrichedApproval[]) => void) | undefined;
    mockList.mockRejectedValueOnce(new MockApiError("加载失败", 500));
    renderWithRouter(<ApprovalsPage />);
    const retry = await screen.findByRole("button", { name: /^重试(：|$)/ });
    await waitFor(() => expect(retry).toHaveFocus());

    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^重试(：|$)/ })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    expect(screen.getByTestId("approvals-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();

    release?.([]);
    expect(await screen.findByText("暂无待审批项")).toBeInTheDocument();
    expect(screen.getByText("所有高风险操作已处理完毕")).toBeInTheDocument();
    expect(screen.queryByTestId("approvals-load-error")).not.toBeInTheDocument();
    expect(queryAnnouncement()).not.toBeInTheDocument();
  });

  it("uses resolveApproval and navigates for chat-continuable approvals", async () => {
    mockList.mockResolvedValueOnce([chatContinuable]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({ status: "ok", assistant_message: "done" });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText("批准并续写")).toBeInTheDocument());
    fireEvent.click(screen.getByText("批准并续写"));
    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalledWith(
        "ap-2",
        "approve",
        "write_file",
        { path: "/tmp/test.txt" },
        "conv-9",
        "tc-9",
      );
      expect(mockApprove).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/chat/conv-9");
    });
    await waitFor(() => expect(screen.getByText("暂无待审批项")).toBeInTheDocument());
    expect(queryAnnouncement()).not.toBeInTheDocument();
  });

  it("sends the typed answer for ask_user and cancels through resolve", async () => {
    const ask: EnrichedApproval = {
      ...chatContinuable,
      id: "ap-ask",
      action: "ask_user",
      params: JSON.stringify({ question: "简报要覆盖最近几天？" }),
    };
    mockList.mockResolvedValueOnce([ask]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({ status: "ok", assistant_message: "继续" });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() =>
      expect(screen.getAllByText("简报要覆盖最近几天？").length).toBeGreaterThan(0),
    );
    const send = screen.getByRole("button", { name: /^发送回答：/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^你的回答：/), { target: { value: "最近三天" } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalledWith(
        "ap-ask",
        "approve",
        "ask_user",
        { question: "简报要覆盖最近几天？" },
        "conv-9",
        "tc-9",
        "最近三天",
      );
      expect(mockNavigate).toHaveBeenCalledWith("/chat/conv-9");
    });
  });

  it("cancels a chat ask_user through resolve deny", async () => {
    const ask: EnrichedApproval = {
      ...chatContinuable,
      id: "ap-ask",
      action: "ask_user",
      params: JSON.stringify({ question: "用哪份资料？" }),
    };
    mockList.mockResolvedValueOnce([ask]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({ status: "denied" });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^取消：/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^取消：/ }));
    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalledWith(
        "ap-ask",
        "deny",
        "ask_user",
        { question: "用哪份资料？" },
        "conv-9",
        "tc-9",
      );
      expect(mockReject).not.toHaveBeenCalled();
    });
  });

  it("links a non-empty task_id to the encoded task page", async () => {
    mockList.mockResolvedValue([
      {
        ...sampleApproval,
        id: "ap-task",
        task_id: "brief/1",
        flow_type: "任务",
        flow_label: "周报",
        correlation_id: "corr-not-a-task",
      },
    ]);
    renderWithRouter(<ApprovalsPage />);
    const link = await screen.findByRole("link", { name: "周报" });
    expect(link).toHaveAttribute("href", "/tasks/brief%2F1");
    expect(screen.queryByRole("link", { name: "corr-not-a-task" })).not.toBeInTheDocument();
  });

  it("encodes a trimmed task_id and ignores surrounding whitespace", async () => {
    mockList.mockResolvedValue([
      {
        ...sampleApproval,
        id: "ap-trim",
        task_id: "  task 2  ",
        flow_label: "带空格",
        correlation_id: "corr-trim",
      },
    ]);
    renderWithRouter(<ApprovalsPage />);
    expect(await screen.findByRole("link", { name: "带空格" })).toHaveAttribute(
      "href",
      "/tasks/task%202",
    );
  });

  it("keeps a blank task_id as plain text and does not link correlation_id", async () => {
    mockList.mockResolvedValue([
      {
        ...sampleApproval,
        id: "ap-blank",
        task_id: "   ",
        flow_label: "只有空白",
        correlation_id: "corr-blank",
      },
      {
        ...sampleApproval,
        id: "ap-null",
        task_id: null,
        flow_label: "没有任务",
        correlation_id: "corr-null",
      },
    ]);
    renderWithRouter(<ApprovalsPage />);
    expect(await screen.findByText("只有空白")).toBeInTheDocument();
    expect(screen.getByText("没有任务")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("still continues the chat when the approval also has a task_id", async () => {
    const item: EnrichedApproval = {
      ...chatContinuable,
      id: "ap-both",
      task_id: "task_9",
      flow_type: "任务",
      flow_label: "可续写任务",
      correlation_id: "chat_corr",
    };
    mockList.mockResolvedValueOnce([item]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({ status: "ok", assistant_message: "done" });
    renderWithRouter(<ApprovalsPage />);
    expect(await screen.findByRole("link", { name: "可续写任务" })).toHaveAttribute(
      "href",
      "/tasks/task_9",
    );
    fireEvent.click(screen.getByText("批准并续写"));
    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalledWith(
        "ap-both",
        "approve",
        "write_file",
        { path: "/tmp/test.txt" },
        "conv-9",
        "tc-9",
      );
      expect(mockNavigate).toHaveBeenCalledWith("/chat/conv-9");
    });
  });

  it("does not send a second decision while the first is still in flight", async () => {
    let release: (value: { id: string; status: string }) => void = () => {};
    mockApprove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mockList.mockResolvedValue([sampleApproval]);
    renderWithRouter(<ApprovalsPage />);
    const approve = await screen.findByRole("button", { name: /^批准：/ });
    const reject = screen.getByRole("button", { name: /^拒绝：/ });
    approve.focus();
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(reject);
    await waitFor(() => expect(approve).toHaveAttribute("aria-busy", "true"));
    expect(approve).toBeEnabled();
    expect(approve).toHaveFocus();
    expect(approve).toHaveClass("opacity-50");
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("aria-busy");
    expect(mockApprove).toHaveBeenCalledTimes(1);
    expect(mockReject).not.toHaveBeenCalled();

    mockList.mockResolvedValue([]);
    release({ id: "ap-1", status: "approved" });
    await waitFor(() => expect(screen.getByText("暂无待审批项")).toBeInTheDocument());
    expect(mockApprove).toHaveBeenCalledTimes(1);
  });

  it("keeps the ask_user answer and returns focus when sending fails", async () => {
    const ask: EnrichedApproval = {
      ...chatContinuable,
      id: "ap-ask",
      action: "ask_user",
      params: JSON.stringify({ question: "简报要覆盖最近几天？" }),
    };
    let fail: (err: unknown) => void = () => {};
    mockResolve.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    mockList.mockResolvedValue([ask]);
    renderWithRouter(<ApprovalsPage />);
    const field = await screen.findByLabelText(/^你的回答：/);
    const send = screen.getByRole("button", { name: /^发送回答：/ });
    expect(send).toBeDisabled();
    fireEvent.change(field, { target: { value: "  最近三天  " } });
    expect(send).toBeEnabled();
    send.focus();
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.click(screen.getByRole("button", { name: /^取消：/ }));

    await waitFor(() => expect(send).toHaveAttribute("aria-busy", "true"));
    expect(send).toBeEnabled();
    expect(send).toHaveFocus();
    expect(send).toHaveClass("opacity-50");
    expect(screen.getByRole("button", { name: /^取消：/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^取消：/ })).not.toHaveAttribute("aria-busy");
    expect(field).toBeEnabled();
    expect(field).toHaveValue("  最近三天  ");
    expect(mockResolve).toHaveBeenCalledTimes(1);
    (document.activeElement as HTMLElement | null)?.blur();

    fail(new MockApiError("发送失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("发送失败", "审批"));
    expect(field).toHaveValue("  最近三天  ");
    expect(field).toBeEnabled();
    expect(screen.getByRole("button", { name: /^发送回答：/ })).toHaveFocus();
    expect(mockResolve).toHaveBeenCalledWith(
      "ap-ask",
      "approve",
      "ask_user",
      { question: "简报要覆盖最近几天？" },
      "conv-9",
      "tc-9",
      "最近三天",
    );
  });

  it("keeps an answer edited during send and does not steal that focus", async () => {
    const ask: EnrichedApproval = {
      ...chatContinuable,
      id: "ap-ask-edit",
      action: "ask_user",
      params: JSON.stringify({ question: "简报要覆盖最近几天？" }),
    };
    let fail: (err: unknown) => void = () => {};
    mockResolve.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    mockList.mockResolvedValue([ask]);
    renderWithRouter(<ApprovalsPage />);
    const field = await screen.findByLabelText(/^你的回答：/);
    fireEvent.change(field, { target: { value: "最近三天" } });
    const send = screen.getByRole("button", { name: /^发送回答：/ });
    send.focus();
    fireEvent.click(send);
    field.focus();
    fireEvent.change(field, { target: { value: "改过了" } });
    fail(new MockApiError("发送失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("发送失败", "审批"));
    expect(field).toHaveValue("改过了");
    expect(field).toHaveFocus();
    expect(send).toBeEnabled();
    expect(send).not.toHaveAttribute("aria-busy");
    expect(mockResolve).toHaveBeenCalledWith(
      "ap-ask-edit",
      "approve",
      "ask_user",
      { question: "简报要覆盖最近几天？" },
      "conv-9",
      "tc-9",
      "最近三天",
    );
  });

  it("does not refresh twice and keeps focus on 刷新", async () => {
    let release: (rows: EnrichedApproval[]) => void = () => {};
    mockList.mockResolvedValueOnce([sampleApproval]);
    renderWithRouter(<ApprovalsPage />);
    await screen.findByRole("button", { name: /^批准：/ });
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const refresh = screen.getByRole("button", { name: "刷新" });
    refresh.focus();
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "true"));
    expect(refresh).toBeEnabled();
    expect(refresh).toHaveFocus();
    expect(refresh).toHaveClass("opacity-50");
    expect(mockList).toHaveBeenCalledTimes(2);

    release([]);
    await waitFor(() => expect(screen.getByText("暂无待审批项")).toBeInTheDocument());
    const again = screen.getByRole("button", { name: "刷新" });
    expect(again).not.toHaveAttribute("aria-busy");
    expect(again).toHaveFocus();
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(queryAnnouncement()).not.toBeInTheDocument();
  });

  it("does not start another read when 刷新 is clicked during the first load", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ApprovalsPage />);
    const refresh = screen.getByRole("button", { name: "刷新" });
    fireEvent.click(refresh);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(refresh).toBeEnabled();
    expect(refresh).not.toHaveAttribute("aria-busy");
  });

  it("moves focus to the next approval after a successful reject", async () => {
    const second: EnrichedApproval = {
      ...sampleApproval,
      id: "ap-2",
      params: JSON.stringify({ path: "/tmp/other.txt" }),
    };
    mockList.mockResolvedValueOnce([sampleApproval, second]).mockResolvedValue([second]);
    mockReject.mockResolvedValue({ id: "ap-1", status: "rejected" });
    renderWithRouter(<ApprovalsPage />);
    const rejects = await screen.findAllByRole("button", { name: /^拒绝：/ });
    rejects[0].focus();
    fireEvent.click(rejects[0]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^批准：/ })).toHaveLength(1));
    expect(screen.getByRole("button", { name: /^批准：/ })).toHaveFocus();
    expect(mockReject).toHaveBeenCalledTimes(1);
    expect(queryAnnouncement()).not.toBeInTheDocument();
  });

  it("returns focus to refresh when the last approval is rejected", async () => {
    let release: (value: { id: string; status: string }) => void = () => {};
    mockList.mockResolvedValueOnce([sampleApproval]).mockResolvedValue([]);
    mockReject.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<ApprovalsPage />);
    const reject = await screen.findByRole("button", { name: /^拒绝：/ });
    reject.focus();
    fireEvent.click(reject);
    expect(reject).toHaveAttribute("aria-busy", "true");
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: /^拒绝：/ }),
    );
    await act(async () => {
      release({ id: "ap-1", status: "rejected" });
    });
    const refresh = screen.getByRole("button", { name: "刷新" });
    await waitFor(() => expect(refresh).toHaveFocus());
    expect(screen.getByText("暂无待审批项")).toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(refresh);
    const status = await findAnnouncement();
    expect(status).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");
    expect(status).toHaveClass("sr-only");
    expect(refresh).toHaveFocus();
  });

  it("does not pull focus back to a failed approval when focus already moved", async () => {
    const second: EnrichedApproval = { ...sampleApproval, id: "ap-2" };
    let fail: (err: unknown) => void = () => {};
    mockReject.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    mockList.mockResolvedValue([sampleApproval, second]);
    renderWithRouter(<ApprovalsPage />);
    const rejects = await screen.findAllByRole("button", { name: /^拒绝：/ });
    fireEvent.click(rejects[0]);
    const nextApprove = (await screen.findAllByRole("button", { name: /^批准：/ }))[1];
    nextApprove.focus();
    fail(new MockApiError("拒绝操作失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("拒绝操作失败", "审批"));
    expect(nextApprove).toHaveFocus();
    expect(mockReject).toHaveBeenCalledTimes(1);
  });

  it("does not navigate when chat resolve resume fails", async () => {
    mockList.mockResolvedValueOnce([chatContinuable]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({
      status: "resume_failed",
      retryable: true,
      error: "llm down",
    });
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText("批准并续写")).toBeInTheDocument());
    fireEvent.click(screen.getByText("批准并续写"));
    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalled();
      expect(addError).toHaveBeenCalledWith("llm down", "审批");
      expect(mockNavigate).not.toHaveBeenCalled();
    });
    expect(queryAnnouncement()).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();
  });

  it("reads the empty queue after the last approval is approved, without moving focus", async () => {
    mockList.mockResolvedValueOnce([sampleApproval]).mockResolvedValue([]);
    mockApprove.mockResolvedValue({ id: "ap-1", status: "approved" });
    renderWithRouter(<ApprovalsPage />);
    const approve = await screen.findByRole("button", { name: /^批准：/ });
    const refresh = screen.getByRole("button", { name: "刷新" });
    approve.focus();
    fireEvent.click(approve);
    refresh.focus();
    await waitFor(() => expect(screen.getByText("暂无待审批项")).toBeInTheDocument());
    const status = await findAnnouncement();
    expect(status).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");
    expect(status).toHaveClass("sr-only");
    expect(refresh).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^批准：/ })).not.toBeInTheDocument();
  });

  it("does not read the empty queue while the decision is still in flight", async () => {
    let release: (value: { id: string; status: string }) => void = () => {};
    mockApprove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mockList.mockResolvedValue([sampleApproval]);
    renderWithRouter(<ApprovalsPage />);
    const approve = await screen.findByRole("button", { name: /^批准：/ });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveAttribute("aria-busy", "true"));
    expect(approve).toHaveAccessibleName("批准：写入文件 /tmp/test.txt");
    expect(queryAnnouncement()).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();

    mockList.mockResolvedValue([]);
    release({ id: "ap-1", status: "approved" });
    expect(await findAnnouncement()).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");
  });

  it("does not read the empty queue when the decision fails", async () => {
    mockReject.mockRejectedValue(new MockApiError("拒绝操作失败", 500));
    mockList.mockResolvedValue([sampleApproval]);
    renderWithRouter(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^拒绝：/ }));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("拒绝操作失败", "审批"));
    expect(screen.getByRole("button", { name: /^拒绝：/ })).toBeInTheDocument();
    expect(queryAnnouncement()).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待审批项")).not.toBeInTheDocument();
  });

  it("reads the empty queue after cancelling the last ask_user", async () => {
    const ask: EnrichedApproval = {
      ...sampleApproval,
      id: "ap-ask",
      action: "ask_user",
      params: JSON.stringify({ question: "用哪份资料？" }),
    };
    mockList.mockResolvedValueOnce([ask]).mockResolvedValue([]);
    mockResolve.mockResolvedValue({ status: "denied" });
    renderWithRouter(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^取消：/ }));
    const status = await findAnnouncement();
    expect(status).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");
    expect(screen.getByRole("button", { name: "刷新" })).toHaveFocus();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reads the empty queue again after it fills and is cleared once more", async () => {
    mockList
      .mockResolvedValueOnce([sampleApproval])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleApproval])
      .mockResolvedValueOnce([]);
    mockReject.mockResolvedValue({ id: "ap-1", status: "rejected" });
    renderWithRouter(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^拒绝：/ }));
    const first = await findAnnouncement();
    expect(first).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("button", { name: /^拒绝：/ });
    expect(queryAnnouncement()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^拒绝：/ }));
    const second = await findAnnouncement();
    expect(second).toHaveTextContent("暂无待审批项 所有高风险操作已处理完毕");
    expect(second).not.toBe(first);
  });

  it("names each decision with the tool and the distinguishing argument", async () => {
    const question = "  前一段\n后一段  ";
    const rows: EnrichedApproval[] = [
      sampleApproval,
      {
        ...sampleApproval,
        id: "ap-mail",
        action: "send_email",
        params: JSON.stringify({
          to: "a@corp.com",
          subject: "主题不进名字",
          body: "正文不进名字",
        }),
        flow_label: "流程名不进名字",
      },
      {
        ...sampleApproval,
        id: "ap-shell",
        action: "shell_exec",
        params: JSON.stringify({
          command: "  echo hi  ",
          limit: 3,
          max_lines: 9,
          unread_only: true,
        }),
      },
      {
        ...sampleApproval,
        id: "ap-ask",
        action: "ask_user",
        conversation_id: "conv-9",
        tool_call_id: "tc-9",
        params: JSON.stringify({ question, context: "补充不进名字" }),
      },
      {
        ...sampleApproval,
        id: "ap-blank",
        action: "   ",
        params: JSON.stringify({ path: "/tmp/ignored.txt" }),
      },
      {
        ...sampleApproval,
        id: "ap-unknown",
        action: "mcp_shell__run_custom_tool",
        params: "{}",
      },
    ];
    mockList.mockResolvedValue(rows);
    renderWithRouter(<ApprovalsPage />);

    const write = await screen.findByRole("button", { name: "批准：写入文件 /tmp/test.txt" });
    expect(write).toHaveTextContent("批准");
    expect(write.textContent).not.toContain("/tmp/test.txt");
    expect(write).toHaveAttribute("title", "批准此操作");
    expect(screen.getByRole("button", { name: "拒绝：写入文件 /tmp/test.txt" })).toHaveTextContent(
      "拒绝",
    );

    const mail = screen.getByRole("button", { name: "批准：发送邮件" });
    expect(mail).toHaveTextContent("批准");
    expect(mail.getAttribute("aria-label")).not.toMatch(/a@corp.com|主题不进名字|正文不进名字/);
    expect(mail.getAttribute("aria-label")).not.toContain("流程名不进名字");
    expect(mail.getAttribute("aria-label")).not.toMatch(/高风险|important/);

    const shell = screen.getByRole("button", { name: /^批准：执行命令/ });
    expect(shell).toHaveAttribute("aria-label", "批准：执行命令 $   echo hi");
    expect(shell.getAttribute("aria-label")).not.toMatch(/limit|max_lines|unread_only|\b3\b|\b9\b/);

    const send = screen.getByRole("button", { name: /^发送回答：向你确认/ });
    expect(send).toHaveTextContent("发送回答");
    expect(send).toHaveAttribute("aria-label", "发送回答：向你确认 前一段\n后一段");
    expect(send.getAttribute("aria-label")).not.toContain("补充不进名字");
    const cancel = screen.getByRole("button", { name: /^取消：向你确认/ });
    expect(cancel).toHaveTextContent("取消");
    expect(cancel).toHaveAttribute("aria-label", "取消：向你确认 前一段\n后一段");
    const field = screen.getByRole("textbox", { name: /^你的回答：前一段/ });
    expect(field).toHaveAttribute("aria-label", "你的回答：前一段\n后一段");
    expect(
      document.querySelector("[data-approval-card='ap-ask'] .whitespace-pre-wrap")?.textContent,
    ).toBe(question);

    const blank = screen.getByRole("button", { name: "批准" });
    expect(blank).not.toHaveAttribute("aria-label");
    expect(blank).toHaveTextContent("批准");

    const unknown = screen.getByRole("button", { name: /^批准：mcp shell/ });
    expect(unknown).toHaveAttribute("aria-label", "批准：mcp shell  run custom tool");
    expect(unknown.getAttribute("aria-label")).not.toContain("_");
  });
});
