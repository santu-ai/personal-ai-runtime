import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import TimelinePage from "./Timeline";

vi.mock("../api/timeline", () => ({
  listTimelineEvents: vi.fn(),
}));

import { listTimelineEvents } from "../api/timeline";

const mockList = vi.mocked(listTimelineEvents);

const makeEvent = (id: string, description: string, ts: string) => ({
  id,
  seq: 1,
  type: "GoalCreated",
  description,
  actor: "user",
  ts,
  payload_snippet: {},
});

describe("TimelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading initially", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<TimelinePage />);
    expect(screen.getByRole("heading", { name: "人生时间线" })).toBeInTheDocument();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders events grouped by day", async () => {
    mockList.mockResolvedValue({
      items: [
        makeEvent("e1", "创建了目标「学习 Rust」", "2026-06-28T08:00:00Z"),
        makeEvent("e2", "AI 记住了新信息", "2026-06-28T09:00:00Z"),
      ],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: { GoalCreated: "target" },
    });
    renderWithRouter(<TimelinePage />);
    await waitFor(() => {
      expect(screen.getByText("人生时间线")).toBeInTheDocument();
      expect(screen.getByText("创建了目标「学习 Rust」")).toBeInTheDocument();
      expect(screen.getByText("2 个事件")).toBeInTheDocument();
    });
  });

  it("shows empty state", async () => {
    mockList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    await waitFor(() => {
      expect(screen.getByText("还没有任何事件")).toBeInTheDocument();
    });
  });

  it("loads more on button click", async () => {
    mockList
      .mockResolvedValueOnce({
        items: [makeEvent("e1", "事件一", "2026-06-28T08:00:00Z")],
        total: 2,
        page: 1,
        page_size: 30,
        has_more: true,
        icons: {},
      })
      .mockResolvedValueOnce({
        items: [makeEvent("e2", "事件二", "2026-06-27T08:00:00Z")],
        total: 2,
        page: 2,
        page_size: 30,
        has_more: false,
        icons: {},
      });
    renderWithRouter(<TimelinePage />);
    await waitFor(() => expect(screen.getByText("事件一")).toBeInTheDocument());
    fireEvent.click(screen.getByText("加载更多"));
    await waitFor(() => {
      expect(screen.getByText("事件二")).toBeInTheDocument();
      expect(mockList).toHaveBeenCalledTimes(2);
    });
  });

  it("links a non-empty work_id to the encoded task page", async () => {
    mockList.mockResolvedValue({
      items: [
        {
          ...makeEvent("e1", "完成了目标「周报」", "2026-06-28T08:00:00Z"),
          work_id: "brief/1",
          payload_snippet: { correlation_id: "corr-not-a-task" },
        },
      ],
      total: 1,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    const link = await screen.findByRole("link", { name: "完成了目标「周报」" });
    expect(link).toHaveAttribute("href", "/tasks/brief%2F1");
  });

  it("encodes a trimmed work_id and ignores surrounding whitespace", async () => {
    mockList.mockResolvedValue({
      items: [
        {
          ...makeEvent("e1", "更新了目标「计划」", "2026-06-28T08:00:00Z"),
          work_id: "  task 2  ",
        },
      ],
      total: 1,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    expect(await screen.findByRole("link", { name: "更新了目标「计划」" })).toHaveAttribute(
      "href",
      "/tasks/task%202",
    );
  });

  it("keeps a blank work_id as plain text and does not link correlation_id", async () => {
    mockList.mockResolvedValue({
      items: [
        {
          ...makeEvent("e1", "AI 记住了新信息", "2026-06-28T08:00:00Z"),
          work_id: "   ",
          payload_snippet: { correlation_id: "corr-blank", task_id: "from-snippet" },
        },
        {
          ...makeEvent("e2", "发起了新对话", "2026-06-28T09:00:00Z"),
          work_id: null,
          payload_snippet: { correlation_id: "corr-null" },
        },
      ],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    expect(await screen.findByText("AI 记住了新信息")).toBeInTheDocument();
    expect(screen.getByText("发起了新对话")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows error with retry", async () => {
    mockList.mockRejectedValue(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    expect(await screen.findByRole("heading", { name: "人生时间线" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("加载失败");
    expect(screen.queryByText("还没有任何事件")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
    mockList.mockResolvedValue({
      items: [makeEvent("e1", "恢复成功", "2026-06-28T08:00:00Z")],
      total: 1,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByText("恢复成功")).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the first-load retry mounted until the reread finishes", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockRejectedValueOnce(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("timeline-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("还没有任何事件")).not.toBeInTheDocument();
    release?.({
      items: [],
      total: 0,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    expect(await screen.findByText("还没有任何事件")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the page fallback when the timeline error has no message", async () => {
    mockList.mockRejectedValue(new Error("  "));
    renderWithRouter(<TimelinePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("加载时间线失败");
    expect(screen.getByRole("heading", { name: "人生时间线" })).toBeInTheDocument();
    expect(screen.queryByText("还没有任何事件")).not.toBeInTheDocument();
  });

  it("keeps listed events when the next page fails and retries that page", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList
      .mockResolvedValueOnce({
        items: [makeEvent("e1", "事件一", "2026-06-28T08:00:00Z")],
        total: 2,
        page: 1,
        page_size: 30,
        has_more: true,
        icons: {},
      })
      .mockRejectedValueOnce(new Error("下一页读不到"));
    renderWithRouter(<TimelinePage />);
    expect(await screen.findByText("事件一")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("下一页读不到");
    expect(screen.getByText("事件一")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "人生时间线" })).toBeInTheDocument();
    expect(screen.queryByText("还没有任何事件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();

    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const retry = within(alert).getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByText("事件一")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-load-error")).toHaveTextContent("下一页读不到");

    release?.({
      items: [makeEvent("e2", "事件二", "2026-06-27T08:00:00Z")],
      total: 2,
      page: 2,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    expect(await screen.findByText("事件二")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("已经是最早的记录")).toBeInTheDocument();
  });

  it("does not fetch the next page twice and keeps focus while another page remains", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockResolvedValueOnce({
      items: [
        {
          ...makeEvent("e1", "事件一", "2026-06-28T08:00:00Z"),
          work_id: "task-1",
        },
      ],
      total: 3,
      page: 1,
      page_size: 30,
      has_more: true,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    const more = await screen.findByRole("button", { name: "加载更多" });
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    more.focus();
    fireEvent.click(more);
    fireEvent.click(more);
    await waitFor(() => expect(more).toHaveAttribute("aria-busy", "true"));
    expect(more).not.toBeDisabled();
    expect(more).toHaveFocus();
    expect(mockList).toHaveBeenCalledTimes(2);

    release?.({
      items: [
        {
          ...makeEvent("e2", "事件二", "2026-06-27T08:00:00Z"),
          work_id: "task-2",
        },
      ],
      total: 3,
      page: 2,
      page_size: 30,
      has_more: true,
      icons: {},
    });
    expect(await screen.findByRole("link", { name: "事件二" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更多" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "事件二" })).not.toHaveFocus();
  });

  it("moves focus to the first new task link when the last page finishes", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockResolvedValueOnce({
      items: [makeEvent("e1", "事件一", "2026-06-28T08:00:00Z")],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: true,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    const more = await screen.findByRole("button", { name: "加载更多" });
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    more.focus();
    fireEvent.click(more);
    release?.({
      items: [
        makeEvent("e2", "先到的纯文本", "2026-06-27T09:00:00Z"),
        {
          ...makeEvent("e3", "后到的任务", "2026-06-27T08:00:00Z"),
          work_id: "brief/9",
        },
      ],
      total: 3,
      page: 2,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    const link = await screen.findByRole("link", { name: "后到的任务" });
    await waitFor(() => expect(link).toHaveFocus());
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("moves focus to the end note when the last page has no task link", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockResolvedValueOnce({
      items: [makeEvent("e1", "事件一", "2026-06-28T08:00:00Z")],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: true,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    const more = await screen.findByRole("button", { name: "加载更多" });
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    more.focus();
    fireEvent.click(more);
    release?.({
      items: [makeEvent("e2", "事件二", "2026-06-27T08:00:00Z")],
      total: 2,
      page: 2,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    const end = await screen.findByText("已经是最早的记录");
    await waitFor(() => expect(end).toHaveFocus());
  });

  it("does not pull focus back when it already moved off 加载更多", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockResolvedValueOnce({
      items: [
        {
          ...makeEvent("e1", "事件一", "2026-06-28T08:00:00Z"),
          work_id: "task-1",
        },
      ],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: true,
      icons: {},
    });
    renderWithRouter(<TimelinePage />);
    const more = await screen.findByRole("button", { name: "加载更多" });
    const first = screen.getByRole("link", { name: "事件一" });
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    more.focus();
    fireEvent.click(more);
    first.focus();
    release?.({
      items: [
        {
          ...makeEvent("e2", "事件二", "2026-06-27T08:00:00Z"),
          work_id: "task-2",
        },
      ],
      total: 2,
      page: 2,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    expect(await screen.findByRole("link", { name: "事件二" })).toBeInTheDocument();
    expect(first).toHaveFocus();
  });

  it("focuses 重试 when loading more fails", async () => {
    mockList
      .mockResolvedValueOnce({
        items: [makeEvent("e1", "事件一", "2026-06-28T08:00:00Z")],
        total: 2,
        page: 1,
        page_size: 30,
        has_more: true,
        icons: {},
      })
      .mockRejectedValueOnce(new Error("下一页读不到"));
    renderWithRouter(<TimelinePage />);
    const more = await screen.findByRole("button", { name: "加载更多" });
    more.focus();
    fireEvent.click(more);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("moves focus to the first task link after the first-load retry succeeds", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockRejectedValueOnce(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(mockList).toHaveBeenCalledTimes(2);
    release?.({
      items: [
        makeEvent("e1", "纯文本", "2026-06-28T09:00:00Z"),
        {
          ...makeEvent("e2", "可打开的任务", "2026-06-28T08:00:00Z"),
          work_id: "task 1",
        },
      ],
      total: 2,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    const link = await screen.findByRole("link", { name: "可打开的任务" });
    await waitFor(() => expect(link).toHaveFocus());
  });

  it("moves focus to the event list when a retry finds no task link", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockRejectedValueOnce(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    release?.({
      items: [makeEvent("e1", "纯文本", "2026-06-28T08:00:00Z")],
      total: 1,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    await waitFor(() => expect(screen.getByTestId("timeline-events")).toHaveFocus());
  });

  it("moves focus to the empty timeline after a retry that finds nothing", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockRejectedValueOnce(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    release?.({
      items: [],
      total: 0,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    await waitFor(() => expect(screen.getByTestId("timeline-empty")).toHaveFocus());
  });

  it("does not pull focus back after a first-load retry when focus already moved", async () => {
    let release: ((row: Awaited<ReturnType<typeof listTimelineEvents>>) => void) | undefined;
    mockList.mockRejectedValueOnce(new Error("加载失败"));
    renderWithRouter(<TimelinePage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "外面";
    document.body.appendChild(outside);
    mockList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    outside.focus();
    release?.({
      items: [
        {
          ...makeEvent("e1", "可打开的任务", "2026-06-28T08:00:00Z"),
          work_id: "task-1",
        },
      ],
      total: 1,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: {},
    });
    expect(await screen.findByRole("link", { name: "可打开的任务" })).toBeInTheDocument();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
