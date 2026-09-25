import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import { TrustReportPanel, trustReportLayoutFocus } from "./TrustReport";

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

/** 这一条卸下的那一轮，绘制前焦点已经在下一处。useEffect 会先停在页面空白。 */
function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  trustReportLayoutFocus.notify = () => {
    if (!gone()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
}

describe("TrustReportPanel", () => {
  beforeEach(() => {
    trustReportLayoutFocus.notify = null;
    vi.clearAllMocks();
  });

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
    expect(screen.queryByText("0 条")).not.toBeInTheDocument();
  });

  it("uses the trust report fallback when the error has no message", async () => {
    mockGetReport.mockRejectedValue(new Error("   "));
    renderPage();
    expect(await screen.findByTestId("trust-report-load-error")).toHaveTextContent(
      "加载信任报告失败",
    );
    expect(screen.queryByText("正在生成信任报告…")).not.toBeInTheDocument();
  });

  it("keeps the trust report retry until the reread finishes", async () => {
    let release: ((row: TrustReportData) => void) | undefined;
    mockGetReport.mockRejectedValue(new Error("失败"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "重试" });
    mockGetReport.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("trust-report-load-error")).toHaveTextContent("失败");
    expect(screen.queryByText("正在生成信任报告…")).not.toBeInTheDocument();

    release?.(BASE);
    expect(await screen.findByText("数据存储位置")).toBeInTheDocument();
    expect(screen.queryByTestId("trust-report-load-error")).not.toBeInTheDocument();
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

  function repair(id: number, aggregate: string) {
    return {
      id,
      aggregate_id: aggregate,
      event_type: "MemoryUpdated",
      event_seq: id,
      error: "chroma unavailable",
      retry_count: 5,
      status: "failed_permanent",
      created_at: "2026-01-01T00:00:00Z",
      last_retry_at: "2026-01-01T00:10:00Z",
    };
  }

  function reportWith(items: ReturnType<typeof repair>[], pending = items.length) {
    return {
      ...BASE,
      memoryIndexRepairs: {
        pending,
        failed_permanent: items.length,
        items,
      },
    };
  }

  it("does not retry the same index twice and keeps focus while in flight", async () => {
    mockGetReport.mockResolvedValue(reportWith([repair(7, "mem-abc"), repair(8, "mem-def")]));
    const pending = new Map<number, (value: { ok: boolean }) => void>();
    mockRetryRepair.mockImplementation(
      (id: number) =>
        new Promise((resolve) => {
          pending.set(id, resolve);
        }),
    );
    renderPage();
    const [first, second] = await screen.findAllByRole("button", { name: "重试索引" });
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    expect(first).not.toBeDisabled();
    expect(first).toHaveFocus();
    expect(first).toHaveClass("opacity-50");
    expect(first).toHaveTextContent("重试中…");
    expect(second).not.toHaveAttribute("aria-busy");
    expect(second).not.toBeDisabled();
    expect(mockRetryRepair).toHaveBeenCalledTimes(1);
    expect(mockRetryRepair).toHaveBeenCalledWith(7);

    fireEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-busy", "true"));
    expect(mockRetryRepair).toHaveBeenCalledTimes(2);
    expect(mockRetryRepair).toHaveBeenNthCalledWith(2, 8);
    expect(first).toHaveAttribute("aria-busy", "true");
    pending.get(7)?.({ ok: true });
    pending.get(8)?.({ ok: true });
    await waitFor(() => expect(first).not.toHaveAttribute("aria-busy"));
    expect(second).not.toHaveAttribute("aria-busy");
  });

  it("keeps focus on 重试索引 when the retry fails", async () => {
    mockGetReport.mockResolvedValue(reportWith([repair(7, "mem-abc")]));
    mockRetryRepair.mockRejectedValue(new Error("索引服务不可用"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "重试索引" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("索引服务不可用")).toBeInTheDocument());
    expect(retry).toHaveFocus();
    expect(retry).toBeEnabled();
    expect(retry).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("mem-abc")).toBeInTheDocument();
    expect(mockRetryRepair).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await waitFor(() => expect(mockRetryRepair).toHaveBeenCalledTimes(2));
  });

  it("keeps focus on the same 重试索引 when the row is still failed", async () => {
    mockGetReport.mockResolvedValue(reportWith([repair(7, "mem-abc")]));
    mockRetryRepair.mockResolvedValue({ ok: true });
    renderPage();
    const retry = await screen.findByRole("button", { name: "重试索引" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy"));
    expect(retry).toHaveFocus();
    expect(screen.getByText("mem-abc")).toBeInTheDocument();
    expect(mockRetryRepair).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the next 重试索引 after this row leaves", async () => {
    let items = [repair(7, "mem-abc"), repair(8, "mem-def")];
    mockGetReport.mockImplementation(async () => reportWith(items));
    mockRetryRepair.mockImplementation(async (id: number) => {
      items = items.filter((row) => row.id !== id);
      return { ok: true };
    });
    renderPage();
    const [first] = await screen.findAllByRole("button", { name: "重试索引" });
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("mem-abc"));
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(screen.getByRole("button", { name: "重试索引" })).toHaveFocus());
    expect(screen.getByText("mem-def")).toBeInTheDocument();
    expect(screen.queryByText("mem-abc")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(screen.getByRole("button", { name: "重试索引" }));
    expect(focusWhenGone.read()).not.toBe(document.body);
    expect(mockRetryRepair).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the previous 重试索引 when the last row leaves", async () => {
    let items = [repair(7, "mem-abc"), repair(8, "mem-def")];
    mockGetReport.mockImplementation(async () => reportWith(items));
    mockRetryRepair.mockImplementation(async (id: number) => {
      items = items.filter((row) => row.id !== id);
      return { ok: true };
    });
    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "重试索引" });
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("mem-def"));
    buttons[1].focus();
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(screen.getByRole("button", { name: "重试索引" })).toHaveFocus());
    expect(screen.getByText("mem-abc")).toBeInTheDocument();
    expect(screen.queryByText("mem-def")).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(screen.getByRole("button", { name: "重试索引" }));
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("does not pull focus back when it already moved away", async () => {
    let items = [repair(7, "mem-abc"), repair(8, "mem-def")];
    let release: (value: { ok: boolean }) => void = () => {};
    mockGetReport.mockImplementation(async () => reportWith(items));
    mockRetryRepair.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(
      <>
        <button type="button" data-dashboard-back="">
          返回今日
        </button>
        <TrustReportPanel compact />
      </>,
    );
    const [first] = await screen.findAllByRole("button", { name: "重试索引" });
    const back = screen.getByRole("button", { name: "返回今日" });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    back.focus();
    items = items.filter((row) => row.id !== 7);
    release({ ok: true });
    await waitFor(() => expect(screen.queryByText("mem-abc")).not.toBeInTheDocument());
    expect(back).toHaveFocus();
    expect(screen.getByText("mem-def")).toBeInTheDocument();
  });

  it("focuses 返回今日 when the last failed repair leaves", async () => {
    let items = [repair(7, "mem-abc")];
    mockGetReport.mockImplementation(async () => reportWith(items, items.length === 0 ? 1 : 0));
    mockRetryRepair.mockImplementation(async () => {
      items = [];
      return { ok: true };
    });
    renderWithRouter(
      <>
        <button type="button" data-dashboard-back="">
          返回今日
        </button>
        <TrustReportPanel compact />
      </>,
    );
    const retry = await screen.findByRole("button", { name: "重试索引" });
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "重试索引" }),
    );
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "返回今日" })).toHaveFocus());
    expect(screen.queryByText("记忆索引修复失败")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试索引" })).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(screen.getByRole("button", { name: "返回今日" }));
    expect(focusWhenGone.read()).not.toBe(document.body);
  });

  it("leaves focus on the page when the last row leaves and there is no back button", async () => {
    let items = [repair(7, "mem-abc")];
    mockGetReport.mockImplementation(async () => reportWith(items));
    mockRetryRepair.mockImplementation(async () => {
      items = [];
      return { ok: true };
    });
    renderPage();
    const retry = await screen.findByRole("button", { name: "重试索引" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "重试索引" })).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(document.body);
  });
});
