import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import { TrustReportPanel } from "./TrustReport";

import { getTrustReport, type TrustReportData } from "../api/trustReport";
import { retryMemoryIndexRepair } from "../api/telemetry";

vi.mock("../api/trustReport", () => ({ getTrustReport: vi.fn() }));
vi.mock("../api/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/telemetry")>();
  return { ...actual, retryMemoryIndexRepair: vi.fn() };
});
const mockGetReport = vi.mocked(getTrustReport);
const mockRetryRepair = vi.mocked(retryMemoryIndexRepair);

const BASE: TrustReportData = {
  system: { conversations: 1, messages: 10, goals: 0, memories: 0, event_log: 1 },
  approvals: [],
  cost: {
    total_calls: 1,
    total_prompt_tokens: 10,
    total_completion_tokens: 5,
    total_cost: 0,
    avg_latency_ms: 500,
    failed_calls: 0,
  },
  costByModel: [],
  tools: [],
  memory: { total_memories: 0, categories: {}, recent_7d: 0 },
  health: { active_work_items: 0, llm_failure_rate_24h: 0, tool_failure_rate_24h: 0 },
  governance: {
    window_days: 7,
    tools_invoked: 0,
    tools_denied: 0,
    tools_deferred: 0,
    approvals_requested: 0,
    approvals_approved: 0,
    approvals_rejected: 0,
    approvals_expired: 0,
    taint_elevated: 0,
    by_tool: {},
    denied_tools: {},
  },
  dashboard: null,
  memoryIndexRepairs: { pending: 0, failed_permanent: 0, items: [] },
};

function renderPage() {
  return renderWithRouter(<TrustReportPanel />);
}

describe("TrustReportPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows loading state", () => {
    mockGetReport.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("正在生成信任报告…")).toBeInTheDocument();
  });

  it("shows error and retry", async () => {
    mockGetReport.mockRejectedValue(new Error("失败"));
    renderPage();
    await waitFor(() => expect(screen.getByText("失败")).toBeInTheDocument(), {
      timeout: 3000,
    });
    const retry = screen.getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    fireEvent.click(retry);
    await waitFor(() => expect(mockGetReport.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows data location section", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      system: { conversations: 5, messages: 42, goals: 0, memories: 12, event_log: 200 },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("数据存储位置")).toBeInTheDocument();
      expect(screen.getByText("本地 (SQLite + Chroma)")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("shows AI activity section", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      system: { conversations: 1, messages: 10, goals: 0, memories: 0, event_log: 50 },
      cost: {
        total_calls: 15,
        total_prompt_tokens: 1000,
        total_completion_tokens: 500,
        total_cost: 0.01,
        avg_latency_ms: 600,
        failed_calls: 1,
      },
      costByModel: [
        {
          provider: "openai",
          model: "gpt-4",
          total_calls: 15,
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
          cost: 0.01,
          avg_latency_ms: 600,
          failed_calls: 1,
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("AI 做了什么")).toBeInTheDocument();
    });
    expect(screen.getAllByText("15 次").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("$0.0100").length).toBeGreaterThanOrEqual(2);
  });

  it("shows combined adoption from governance", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      governance: {
        ...BASE.governance!,
        approvals_approved: 3,
        approvals_rejected: 1,
        adoption: {
          days: 7,
          suggestions: {
            days: 7,
            adopted: 3,
            rejected: 1,
            expired: 0,
            auto_allowed: 2,
            decided: 4,
            adoption_rate: 0.75,
          },
          memories: {
            ratified: 1,
            rejected: 1,
            auto_expired: 0,
            proposed_open: 0,
            decided: 2,
            conversion_rate: 0.5,
          },
          adopted: 4,
          rejected: 2,
          decided: 6,
          adoption_rate: 4 / 6,
        },
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("adoption-summary")).toHaveTextContent("近 7 日 67%");
    });
    expect(screen.getByText(/采纳率 75%/)).toBeInTheDocument();
  });

  it("shows empty approvals", async () => {
    mockGetReport.mockResolvedValue(BASE);
    renderPage();
    await waitFor(() => expect(screen.getByText("没有等待审批的操作")).toBeInTheDocument());
  });

  it("shows pending approvals with flow context", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      approvals: [
        {
          id: "a1",
          action: "write_file",
          status: "pending",
          flow_type: "对话",
          flow_label: "讨论",
          correlation_id: "c1",
          proposed_by: "w",
        },
        {
          id: "a2",
          action: "send_email",
          status: "pending",
          flow_type: "任务",
          flow_label: "邮件",
          correlation_id: "c2",
          proposed_by: "w",
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("write_file")).toBeInTheDocument();
      expect(screen.getByText("send_email")).toBeInTheDocument();
    });
    const writeFile = screen.getByRole("link", { name: "write_file" });
    expect(writeFile).toHaveAttribute("href", "/approvals");
    expect(writeFile).toHaveClass("focus-visible:ring-focus-ring");
    const sendEmail = screen.getByRole("link", { name: "send_email" });
    expect(sendEmail).toHaveAttribute("href", "/approvals");
    expect(sendEmail).toHaveClass("focus-visible:ring-focus-ring");
    expect(screen.getByText("讨论").closest("a")).toBeNull();
    expect(screen.getByText("邮件").closest("a")).toBeNull();
  });

  it("keeps a pending approval row as text when it has no id", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      approvals: [
        {
          id: "   ",
          action: "shell_exec",
          status: "pending",
          flow_type: "系统",
          flow_label: "corr_only",
          correlation_id: "corr_only",
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("shell_exec")).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "shell_exec" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "corr_only" })).not.toBeInTheDocument();
    expect(screen.getByText("corr_only")).toBeInTheDocument();
  });

  it("shows memory index repair alert and retry", async () => {
    mockGetReport.mockResolvedValue({
      ...BASE,
      memoryIndexRepairs: {
        pending: 0,
        failed_permanent: 1,
        items: [
          {
            id: 7,
            aggregate_id: "mem-abc",
            event_type: "MemoryUpdated",
            event_seq: 2,
            error: "chroma unavailable",
            retry_count: 5,
            status: "failed_permanent",
            created_at: "2026-01-01T00:00:00Z",
            last_retry_at: "2026-01-01T00:10:00Z",
          },
        ],
      },
    });
    mockRetryRepair.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("记忆索引修复失败")).toBeInTheDocument();
      expect(screen.getByText("mem-abc")).toBeInTheDocument();
    });
    const retryIndex = screen.getByRole("button", { name: "重试索引" });
    expect(retryIndex).toHaveClass("focus-visible:ring-focus-ring");
    fireEvent.click(retryIndex);
    await waitFor(() => expect(mockRetryRepair).toHaveBeenCalledWith(7));
  });
});
