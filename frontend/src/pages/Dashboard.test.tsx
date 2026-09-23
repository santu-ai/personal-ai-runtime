import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import DashboardPage from "./Dashboard";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderDashboard(entries = ["/dashboard"]) {
  return renderWithRouter(<DashboardPage />, { initialEntries: entries });
}

vi.mock("../hooks/useDashboard", () => ({
  useDashboard: vi.fn(),
}));

vi.mock("../hooks/useApprovalsQuery", () => ({
  useApprovalsQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock("../hooks/useInboxQuery", () => ({
  useInboxQuery: vi.fn(() => ({ data: { emails: [], digest: {} } })),
}));

vi.mock("../hooks/useGoalsQuery", () => ({
  useGoalsQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock("../hooks/useMemoriesQuery", () => ({
  useProposedMemoryCountQuery: vi.fn(() => ({ data: 0 })),
}));

vi.mock("../api/telemetry", () => ({
  getGovernanceSummary: vi.fn(),
}));

vi.mock("../api/system", async () => {
  const actual = await vi.importActual<typeof import("../api/system")>("../api/system");
  return {
    ...actual,
    getPeriodComparison: vi.fn(),
  };
});

import { getGovernanceSummary } from "../api/telemetry";
import { getPeriodComparison } from "../api/system";
import { useDashboard } from "../hooks/useDashboard";
import { useApprovalsQuery } from "../hooks/useApprovalsQuery";
import { useInboxQuery } from "../hooks/useInboxQuery";
import { useGoalsQuery } from "../hooks/useGoalsQuery";
import { useProposedMemoryCountQuery } from "../hooks/useMemoriesQuery";

const mockGovernance = vi.mocked(getGovernanceSummary);
const mockPeriodComparison = vi.mocked(getPeriodComparison);

const mockUseDashboard = vi.mocked(useDashboard);
const mockUseApprovalsQuery = vi.mocked(useApprovalsQuery);
const mockUseInboxQuery = vi.mocked(useInboxQuery);
const mockUseGoalsQuery = vi.mocked(useGoalsQuery);
const mockUseProposedMemoryCountQuery = vi.mocked(useProposedMemoryCountQuery);

function mockDashboardData(overrides: Partial<ReturnType<typeof useDashboard>> = {}) {
  mockUseDashboard.mockReturnValue({
    cost: {
      total_prompt_tokens: 5000,
      total_completion_tokens: 3000,
      total_cost: 0.05,
      avg_latency_ms: 1200,
      total_calls: 42,
      failed_calls: 2,
    },
    costByModel: [
      {
        provider: "deepseek",
        model: "deepseek-chat",
        total_calls: 30,
        prompt_tokens: 4000,
        completion_tokens: 2000,
        total_tokens: 6000,
        cost: 0.04,
        avg_latency_ms: 1100,
        failed_calls: 1,
      },
    ],
    tools: [
      { tool_name: "web_search", total_calls: 15, failed_calls: 1, avg_latency_ms: 800 },
      { tool_name: "read_file", total_calls: 10, failed_calls: 0, avg_latency_ms: 200 },
    ],
    memory: {
      total_memories: 120,
      recent_7d: 8,
      categories: { habit: 30, work: 25 },
    },
    health: {
      active_work_items: 3,
      llm_failure_rate_24h: 0.01,
      tool_failure_rate_24h: 0.02,
    },
    notifications: [
      {
        id: "n1",
        type: "reminder",
        title: "喝水提醒",
        content: "该喝水了",
        created_at: "2026-06-10T08:00:00Z",
      },
    ],
    dashboard: null,
    loading: false,
    error: "",
    refresh: vi.fn(),
    ...overrides,
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApprovalsQuery.mockReturnValue({ data: [] } as unknown as ReturnType<
      typeof useApprovalsQuery
    >);
    mockUseInboxQuery.mockReturnValue({
      data: { emails: [], digest: {} },
    } as unknown as ReturnType<typeof useInboxQuery>);
    mockUseGoalsQuery.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useGoalsQuery>);
    mockUseProposedMemoryCountQuery.mockReturnValue({ data: 0 } as unknown as ReturnType<
      typeof useProposedMemoryCountQuery
    >);
    mockDashboardData();
    mockPeriodComparison.mockResolvedValue({
      days: 7,
      current: { start: "2026-09-15T00:00:00+00:00", end: "2026-09-22T00:00:00+00:00" },
      previous: { start: "2026-09-08T00:00:00+00:00", end: "2026-09-15T00:00:00+00:00" },
      signals: {
        goals_completed: { current: 2, previous: 1, delta: 1 },
        tasks_completed: { current: 0, previous: 0, delta: 0 },
        work_completed_untyped: { current: 0, previous: 0, delta: 0 },
        inbox_recorded: { current: 3, previous: 1, delta: 2 },
        adoption_decided: { current: 0, previous: 0, delta: 0 },
        adoption_rate: { current: null, previous: null, delta: null },
      },
      capped: false,
    });
    mockGovernance.mockResolvedValue({
      window_days: 7,
      tools_invoked: 0,
      tools_denied: 0,
      tools_deferred: 0,
      approvals_requested: 0,
      approvals_approved: 3,
      approvals_rejected: 1,
      approvals_expired: 0,
      taint_elevated: 0,
      by_tool: {},
      denied_tools: {},
      adoption: {
        days: 7,
        suggestions: {
          days: 7,
          adopted: 3,
          rejected: 1,
          expired: 0,
          auto_allowed: 0,
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
    });
  });

  it("renders today title and adoption rate", async () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "今天" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("adoption-summary")).toHaveTextContent("近 7 日 67%");
    });
    expect(screen.getByTestId("period-comparison")).toHaveTextContent("完成目标");
    expect(screen.getByTestId("period-comparison")).toHaveTextContent("+1");
  });

  it("shows loading state", () => {
    mockDashboardData({ loading: true });
    renderDashboard();
    expect(screen.getAllByText("加载中...")[0]).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const mockRefresh = vi.fn();
    mockDashboardData({ error: "后端连接失败", loading: false, refresh: mockRefresh });
    renderDashboard();
    expect(screen.getAllByText("后端连接失败")[0]).toBeInTheDocument();
    const retryButtons = screen.getAllByText("重试");
    fireEvent.click(retryButtons[0]);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("renders proactive reminders section", () => {
    renderDashboard();
    expect(screen.getAllByText("AI 给你的提醒")[0]).toBeInTheDocument();
    expect(screen.getAllByText("喝水提醒")[0]).toBeInTheDocument();
  });

  it("shows empty reminder message when none present", () => {
    mockDashboardData({ notifications: [] });
    renderDashboard();
    expect(screen.getAllByText("暂无提醒")[0]).toBeInTheDocument();
  });

  it("hides health section by default", () => {
    renderDashboard();
    expect(screen.queryByText("LLM 成功率")).not.toBeInTheDocument();
  });

  it("shows health section when expanded", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("运行状况"));
    expect(screen.getAllByText("LLM 成功率")[0]).toBeInTheDocument();
    expect(screen.getAllByText("95.2%")[0]).toBeInTheDocument();
  });

  it("shows memory section inside health when expanded", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("运行状况"));
    expect(screen.getAllByText("AI 记住了")[0]).toBeInTheDocument();
    expect(screen.getAllByText("habit: 30")[0]).toBeInTheDocument();
  });

  it("shows tool calls in health section when expanded", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("运行状况"));
    expect(screen.getAllByText("工具调用 (7天)")[0]).toBeInTheDocument();
    expect(screen.getAllByText("搜索网页")[0]).toBeInTheDocument();
  });

  it("shows empty state when no actions", () => {
    renderDashboard();
    expect(screen.getAllByText("今天暂无紧急事项")[0]).toBeInTheDocument();
  });

  it("shows pending approval card and navigates to approvals", () => {
    mockUseApprovalsQuery.mockReturnValue({
      data: [
        {
          id: "ap-1",
          action: "write_file",
          status: "pending",
          params: "{}",
          created_at: "2026-06-28T10:00:00Z",
        },
      ],
    } as unknown as ReturnType<typeof useApprovalsQuery>);
    renderDashboard();
    expect(screen.getByText("需要你决定")).toBeInTheDocument();
    expect(screen.getByText("write_file")).toBeInTheDocument();
    fireEvent.click(screen.getByText("write_file"));
    expect(mockNavigate).toHaveBeenCalledWith("/approvals");
  });

  it("shows inbox card when pending emails exist", () => {
    mockUseInboxQuery.mockReturnValue({
      data: {
        emails: [
          {
            id: "e1",
            subject: "Hello",
            category: "important",
            from: "a@b.com",
            date: "",
            preview: "",
          },
        ],
        digest: {},
      },
    } as unknown as ReturnType<typeof useInboxQuery>);
    renderDashboard();
    expect(screen.getByText("需要你决定")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls refresh on button click", () => {
    const mockRefresh = vi.fn();
    mockDashboardData({ refresh: mockRefresh });
    renderDashboard();
    const refreshButtons = screen.getAllByText("刷新");
    fireEvent.click(refreshButtons[0]);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("shows execution trust from dashboard widget", () => {
    mockDashboardData({
      dashboard: {
        generated_at: "2026-08-17T00:00:00Z",
        data_sovereignty: {
          total_events: 1,
          total_memories: 1,
          memories_self_report: 0,
          memories_claim: 1,
          total_goals: 0,
          goals_active: 0,
          goals_completed: 0,
          total_conversations: 0,
          total_messages: 0,
          data_location: "本地",
          last_belief_reflection: null,
          export_supported: true,
        },
        active_goals: { count: 0, top: [] },
        execution_trust: {
          by_status: { failed: 1, completed: 2, in_retry: 1 },
          pending_approvals: 0,
          failed: [
            {
              id: "ex1",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "imap timeout",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:00:00Z",
              completed_at: "2026-08-17T00:01:00Z",
              correlation_id: "",
            },
          ],
          in_retry: [
            {
              id: "ex2",
              status: "in_retry",
              handler_name: "memory_decay",
              event_type: "TimerFired",
              error: "lock",
              retry_count: 1,
              dead_letter: false,
              created_at: "2026-08-17T00:02:00Z",
              completed_at: null,
              correlation_id: "",
            },
          ],
          dead_letter: [],
          dead_letter_count: 1,
          last_completed: null,
          last_failed: {
            id: "ex1",
            status: "failed",
            handler_name: "inbox_poll",
            event_type: "InboxPollRequested",
            error: "imap timeout",
            retry_count: 3,
            dead_letter: true,
            created_at: "2026-08-17T00:00:00Z",
            completed_at: "2026-08-17T00:01:00Z",
            correlation_id: "",
          },
        },
      },
    });
    renderDashboard();
    expect(screen.getByTestId("execution-trust")).toBeInTheDocument();
    expect(screen.getByText(/imap timeout/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /imap timeout/ })).not.toBeInTheDocument();
    expect(screen.getByText(/重试中 memory_decay/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /memory_decay/ })).not.toBeInTheDocument();
  });

  it("links execution failures to an existing task and leaves the rest as text", () => {
    mockDashboardData({
      dashboard: {
        generated_at: "2026-08-17T00:00:00Z",
        data_sovereignty: {
          total_events: 1,
          total_memories: 0,
          memories_self_report: 0,
          memories_claim: 0,
          total_goals: 0,
          goals_active: 0,
          goals_completed: 0,
          total_conversations: 0,
          total_messages: 0,
          data_location: "本地",
          last_belief_reflection: null,
          export_supported: true,
        },
        active_goals: { count: 0, top: [] },
        execution_trust: {
          by_status: { failed: 1, in_retry: 1 },
          pending_approvals: 0,
          failed: [],
          in_retry: [
            {
              id: "ex-retry",
              status: "in_retry",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "still trying",
              retry_count: 1,
              dead_letter: false,
              created_at: "2026-08-17T00:02:00Z",
              completed_at: null,
              correlation_id: "corr-retry",
              work_id: "task_retry",
            },
          ],
          dead_letter: [
            {
              id: "ex-dead",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "plan crashed",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:03:00Z",
              completed_at: "2026-08-17T00:04:00Z",
              correlation_id: "corr-dead",
              work_id: "task/dead",
            },
            {
              id: "ex-orphan",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "no owner",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:01:00Z",
              completed_at: "2026-08-17T00:02:00Z",
              correlation_id: "task_should_not_link",
              work_id: null,
            },
          ],
          dead_letter_count: 2,
          last_completed: null,
          last_failed: {
            id: "ex-failed",
            status: "failed",
            handler_name: "handle_execute",
            event_type: "ExecuteRequested",
            error: "handler down",
            retry_count: 1,
            dead_letter: false,
            created_at: "2026-08-17T00:05:00Z",
            completed_at: "2026-08-17T00:06:00Z",
            correlation_id: "corr-failed",
            work_id: "task_failed",
          },
        },
      },
    });
    renderDashboard();
    expect(screen.getByRole("link", { name: /handler down/ })).toHaveAttribute(
      "href",
      "/tasks/task_failed",
    );
    expect(screen.getByRole("link", { name: /plan crashed/ })).toHaveAttribute(
      "href",
      "/tasks/task%2Fdead",
    );
    expect(screen.getByText(/no owner/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /no owner/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /重试中 handle_execute/ })).toHaveAttribute(
      "href",
      "/tasks/task_retry",
    );
  });

  it("shows one row when the latest failure is also a dead letter", () => {
    mockDashboardData({
      dashboard: {
        generated_at: "2026-08-17T00:00:00Z",
        data_sovereignty: {
          total_events: 1,
          total_memories: 0,
          memories_self_report: 0,
          memories_claim: 0,
          total_goals: 0,
          goals_active: 0,
          goals_completed: 0,
          total_conversations: 0,
          total_messages: 0,
          data_location: "本地",
          last_belief_reflection: null,
          export_supported: true,
        },
        active_goals: { count: 0, top: [] },
        execution_trust: {
          by_status: { failed: 1 },
          pending_approvals: 0,
          failed: [],
          in_retry: [
            {
              id: "ex-retry-blank",
              status: "in_retry",
              handler_name: "memory_decay",
              event_type: "TimerFired",
              error: null,
              retry_count: 2,
              dead_letter: false,
              created_at: "2026-08-17T00:06:00Z",
              completed_at: null,
              correlation_id: "task_should_not_link",
              work_id: "   ",
            },
          ],
          dead_letter: [
            {
              id: "ex-shared",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "same boom",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:05:00Z",
              completed_at: "2026-08-17T00:05:30Z",
              correlation_id: "shared-corr",
              work_id: "task_shared",
            },
            {
              id: "ex-corr-only",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "different row",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:04:00Z",
              completed_at: "2026-08-17T00:04:30Z",
              correlation_id: "shared-corr",
              work_id: null,
            },
            {
              id: "ex-d3",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "third letter",
              retry_count: 1,
              dead_letter: true,
              created_at: "2026-08-17T00:03:00Z",
              completed_at: null,
              correlation_id: "corr-3",
              work_id: null,
            },
            {
              id: "ex-d4",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "fourth letter",
              retry_count: 1,
              dead_letter: true,
              created_at: "2026-08-17T00:02:00Z",
              completed_at: null,
              correlation_id: "corr-4",
              work_id: "task_fourth",
            },
          ],
          dead_letter_count: 4,
          last_completed: null,
          last_failed: {
            id: "ex-shared",
            status: "failed",
            handler_name: "handle_execute",
            event_type: "ExecuteRequested",
            error: "same boom",
            retry_count: 3,
            dead_letter: true,
            created_at: "2026-08-17T00:05:00Z",
            completed_at: "2026-08-17T00:05:30Z",
            correlation_id: "shared-corr",
            work_id: "task_shared",
          },
        },
      },
    });
    renderDashboard();

    expect(screen.getAllByText(/same boom/)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /same boom/ })).toHaveAttribute(
      "href",
      "/tasks/task_shared",
    );
    expect(
      screen.queryByRole("link", { name: /死信 handle_execute · same boom/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/different row/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /different row/ })).not.toBeInTheDocument();
    expect(screen.getByText(/third letter/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fourth letter/ })).toHaveAttribute(
      "href",
      "/tasks/task_fourth",
    );
    expect(screen.getByText(/死信 4/)).toBeInTheDocument();
    expect(screen.getByText(/重试中 memory_decay · 第 2 次/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /memory_decay/ })).not.toBeInTheDocument();
  });

  it("lists other recent failures without repeating the newest or a dead letter", () => {
    mockDashboardData({
      dashboard: {
        generated_at: "2026-08-17T00:00:00Z",
        data_sovereignty: {
          total_events: 1,
          total_memories: 0,
          memories_self_report: 0,
          memories_claim: 0,
          total_goals: 0,
          goals_active: 0,
          goals_completed: 0,
          total_conversations: 0,
          total_messages: 0,
          data_location: "本地",
          last_belief_reflection: null,
          export_supported: true,
        },
        active_goals: { count: 0, top: [] },
        execution_trust: {
          by_status: { failed: 6, in_retry: 1 },
          pending_approvals: 0,
          failed: [
            {
              id: "ex-new",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "newest boom",
              retry_count: 1,
              dead_letter: false,
              created_at: "2026-08-17T00:06:00Z",
              completed_at: "2026-08-17T00:06:30Z",
              correlation_id: "corr-new",
              work_id: "task_new",
            },
            {
              id: "ex-mid",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "middle miss",
              retry_count: 1,
              dead_letter: false,
              created_at: "2026-08-17T00:05:00Z",
              completed_at: "2026-08-17T00:05:30Z",
              correlation_id: "corr-mid",
              work_id: "task/mid",
            },
            {
              id: "ex-plain",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "plain miss",
              retry_count: 0,
              dead_letter: false,
              created_at: "2026-08-17T00:04:00Z",
              completed_at: "2026-08-17T00:04:30Z",
              correlation_id: "task_should_not_link",
              work_id: null,
            },
            {
              id: "ex-blank",
              status: "failed",
              handler_name: "memory_decay",
              event_type: "TimerFired",
              error: "blank owner",
              retry_count: 0,
              dead_letter: false,
              created_at: "2026-08-17T00:03:30Z",
              completed_at: "2026-08-17T00:03:40Z",
              correlation_id: "",
              work_id: "   ",
            },
            {
              id: "ex-shared",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "shared letter",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:03:00Z",
              completed_at: "2026-08-17T00:03:20Z",
              correlation_id: "corr-shared",
              work_id: "task_shared",
            },
            {
              id: "ex-buried",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "buried letter",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:00:30Z",
              completed_at: null,
              correlation_id: "corr-buried",
              work_id: "task_buried",
            },
          ],
          in_retry: [
            {
              id: "ex-retry",
              status: "in_retry",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "still waiting",
              retry_count: 2,
              dead_letter: false,
              created_at: "2026-08-17T00:07:00Z",
              completed_at: null,
              correlation_id: "corr-retry",
              work_id: "task_retry",
            },
          ],
          dead_letter: [
            {
              id: "ex-shared",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "shared letter",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:03:00Z",
              completed_at: "2026-08-17T00:03:20Z",
              correlation_id: "corr-shared",
              work_id: "task_shared",
            },
            {
              id: "ex-d2",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "second letter",
              retry_count: 1,
              dead_letter: true,
              created_at: "2026-08-17T00:02:00Z",
              completed_at: null,
              correlation_id: "corr-d2",
              work_id: null,
            },
            {
              id: "ex-d3",
              status: "failed",
              handler_name: "inbox_poll",
              event_type: "InboxPollRequested",
              error: "third letter",
              retry_count: 1,
              dead_letter: true,
              created_at: "2026-08-17T00:01:00Z",
              completed_at: null,
              correlation_id: "corr-d3",
              work_id: null,
            },
            {
              id: "ex-buried",
              status: "failed",
              handler_name: "handle_execute",
              event_type: "ExecuteRequested",
              error: "buried letter",
              retry_count: 3,
              dead_letter: true,
              created_at: "2026-08-17T00:00:30Z",
              completed_at: null,
              correlation_id: "corr-buried",
              work_id: "task_buried",
            },
          ],
          dead_letter_count: 4,
          last_completed: null,
          last_failed: {
            id: "ex-new",
            status: "failed",
            handler_name: "handle_execute",
            event_type: "ExecuteRequested",
            error: "newest boom",
            retry_count: 1,
            dead_letter: false,
            created_at: "2026-08-17T00:06:00Z",
            completed_at: "2026-08-17T00:06:30Z",
            correlation_id: "corr-new",
            work_id: "task_new",
          },
        },
      },
    });
    renderDashboard();

    expect(screen.getByText(/失败 6/)).toBeInTheDocument();
    expect(screen.getAllByText(/newest boom/)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /newest boom/ })).toHaveAttribute(
      "href",
      "/tasks/task_new",
    );
    expect(screen.getByRole("link", { name: /middle miss/ })).toHaveAttribute(
      "href",
      "/tasks/task%2Fmid",
    );
    expect(screen.getByText(/plain miss/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /plain miss/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /task_should_not_link/ })).not.toBeInTheDocument();
    expect(screen.getByText(/blank owner/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /blank owner/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/shared letter/)).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /死信 handle_execute · shared letter/ }),
    ).toHaveAttribute("href", "/tasks/task_shared");
    expect(screen.getByText(/second letter/)).toBeInTheDocument();
    expect(screen.getByText(/third letter/)).toBeInTheDocument();
    expect(screen.queryByText(/buried letter/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /still waiting/ })).toHaveAttribute(
      "href",
      "/tasks/task_retry",
    );
    expect(screen.getByText(/重试中 handle_execute · 第 2 次 · still waiting/)).toBeInTheDocument();
  });

  it("does not repeat an approval or morning brief in reminders", () => {
    mockUseApprovalsQuery.mockReturnValue({
      data: [{ id: "ap-1", action: "write_file", status: "pending" }],
    } as unknown as ReturnType<typeof useApprovalsQuery>);
    mockDashboardData({
      notifications: [
        {
          id: "n-brief",
          type: "morning_brief",
          title: "早安简报 - 2026-08-31",
          content: "今日摘要",
          created_at: new Date().toISOString(),
        },
        {
          id: "n-rem",
          type: "reminder",
          title: "独立提醒",
          content: "不能进三栏",
          created_at: new Date().toISOString(),
        },
      ],
    });
    renderDashboard();
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("早安简报 - 2026-08-31")).toBeInTheDocument();
    expect(screen.getByText("独立提醒")).toBeInTheDocument();
    const reminderSection = screen.getByText("AI 给你的提醒").closest("div")?.parentElement;
    expect(reminderSection?.textContent).not.toContain("write_file");
    expect(reminderSection?.textContent).not.toContain("早安简报");
  });
});
