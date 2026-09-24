import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter, MockApiError } from "../test-utils";
import ApprovalsPage from "./Approvals";
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
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  it("shows loading state initially", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ApprovalsPage />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("shows empty state when no approvals", async () => {
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => {
      expect(screen.getByText("暂无待审批项")).toBeInTheDocument();
    });
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
    renderWithRouter(<ApprovalsPage />);
    await waitFor(() => {
      expect(addError).toHaveBeenCalledWith("加载失败", "审批");
    });
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
    const send = screen.getByRole("button", { name: "发送回答" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("你的回答"), { target: { value: "最近三天" } });
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
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
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
  });
});
