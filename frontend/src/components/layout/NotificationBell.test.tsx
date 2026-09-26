import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import NotificationBell, { notificationBellLayoutFocus } from "./NotificationBell";

const { listNotifications, markAllNotificationsRead, addError } = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  addError: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead: vi.fn(),
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (state: { addError: typeof addError }) => unknown) =>
    selector({ addError }),
}));

const sample = {
  id: "n1",
  title: "待审批",
  content: "写入文件需要确认",
  type: "approval",
  read: 0,
  created_at: "2026-08-17T10:00:00Z",
};

/** 按钮卸下的那一轮，绘制前焦点已经在目标上。useEffect 会先停在页面空白。 */
function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  notificationBellLayoutFocus.notify = () => {
    if (!gone()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
}

function holdMarkAll() {
  let release: () => void = () => {};
  markAllNotificationsRead.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

describe("NotificationBell", () => {
  beforeEach(() => {
    notificationBellLayoutFocus.notify = null;
    vi.clearAllMocks();
    listNotifications.mockResolvedValue([sample]);
    markAllNotificationsRead.mockResolvedValue(undefined);
  });

  it("writes 通知 on the icon when the rail is compact", () => {
    renderWithRouter(<NotificationBell compact />);
    const bell = screen.getByRole("button", { name: "通知" });
    const name = bell.querySelector("[data-rail-name]");
    expect(name).toHaveTextContent("通知");
    expect(name).toHaveClass("hidden", "group-focus-visible:block");
    expect(bell.querySelector("svg")?.parentElement).toHaveClass("group-focus-visible:hidden");
  });

  it("moves focus into the panel and returns it to the bell on Escape", async () => {
    let focusAtLayout: Element | null = null;
    notificationBellLayoutFocus.notify = () => {
      focusAtLayout = document.activeElement;
    };
    renderWithRouter(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "通知" });
    bell.focus();
    fireEvent.click(bell);
    const panel = screen.getByRole("dialog", { name: "最近通知" });
    expect(focusAtLayout).toBe(panel);
    expect(panel).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it("stays open when Escape is pressed while an input method is composing", async () => {
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const panel = await screen.findByRole("dialog", { name: "最近通知" });
    await waitFor(() => expect(panel).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    fireEvent.keyDown(window, { key: "Escape", keyCode: 229 });
    expect(screen.getByRole("dialog", { name: "最近通知" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
  });

  it("keeps Tab inside the notification panel", async () => {
    const second = { ...sample, id: "n2", title: "另一条", content: "还在" };
    listNotifications.mockResolvedValue([sample, second]);
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const panel = await screen.findByRole("dialog", { name: "最近通知" });
    const mark = await screen.findByRole("button", { name: "全部已读" });
    const first = screen.getByRole("button", { name: /待审批/ });
    const otherRow = screen.getByRole("button", { name: /另一条/ });
    const outside = screen.getByRole("button", { name: "旁边" });
    const bell = screen.getByRole("button", { name: "通知" });
    await waitFor(() => expect(panel).toHaveFocus());

    const disabled = document.createElement("button");
    disabled.type = "button";
    disabled.disabled = true;
    disabled.textContent = "不可用";
    const hidden = document.createElement("button");
    hidden.type = "button";
    hidden.hidden = true;
    hidden.textContent = "藏起来";
    const skipped = document.createElement("button");
    skipped.type = "button";
    skipped.tabIndex = -1;
    skipped.textContent = "不进顺序";
    panel.append(disabled, hidden, skipped);

    fireEvent.keyDown(panel, { key: "Tab" });
    expect(mark).toHaveFocus();
    fireEvent.keyDown(mark, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab" });
    expect(otherRow).toHaveFocus();
    fireEvent.keyDown(otherRow, { key: "Tab" });
    expect(mark).toHaveFocus();
    expect(outside).not.toHaveFocus();
    expect(disabled).not.toHaveFocus();
    expect(hidden).not.toHaveFocus();
    expect(skipped).not.toHaveFocus();

    fireEvent.keyDown(mark, { key: "Tab", shiftKey: true });
    expect(otherRow).toHaveFocus();
    panel.focus();
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(otherRow).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(mark).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(otherRow).toHaveFocus();
    expect(bell).not.toHaveFocus();

    fireEvent.keyDown(otherRow, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it("keeps Tab on the panel when the list has no controls", async () => {
    listNotifications.mockResolvedValue([]);
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const panel = await screen.findByRole("dialog", { name: "最近通知" });
    await screen.findByText("暂无通知");
    await waitFor(() => expect(panel).toHaveFocus());
    const outside = screen.getByRole("button", { name: "旁边" });

    fireEvent.keyDown(panel, { key: "Tab" });
    expect(panel).toHaveFocus();
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(panel).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(panel).toHaveFocus();
    expect(outside).not.toHaveFocus();
  });

  it("keeps Tab on the retry button when it is the only control", async () => {
    listNotifications.mockRejectedValue(new Error("通知暂时读不到"));
    let focusAtLayout: Element | null = null;
    notificationBellLayoutFocus.notify = () => {
      const panel = document.querySelector("[aria-label='最近通知']");
      if (!(panel instanceof HTMLElement)) return;
      focusAtLayout ??= document.activeElement;
    };
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const panel = screen.getByRole("dialog", { name: "最近通知" });
    expect(focusAtLayout).toBe(panel);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.keyDown(retry, { key: "Tab" });
    expect(retry).toHaveFocus();
    fireEvent.keyDown(retry, { key: "Tab", shiftKey: true });
    expect(retry).toHaveFocus();
    expect(screen.getByRole("button", { name: "旁边" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "通知" })).not.toHaveFocus();
  });

  it("stops trapping Tab after the panel closes", async () => {
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    await screen.findByRole("dialog", { name: "最近通知" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();

    const outside = screen.getByRole("button", { name: "旁边" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(outside).toHaveFocus();
    expect(bell).not.toHaveFocus();
  });

  it("keeps a busy mark-all button in the Tab cycle", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    const row = screen.getByRole("button", { name: /待审批/ });
    mark.focus();
    fireEvent.click(mark);
    expect(mark).toHaveAttribute("aria-busy", "true");
    expect(mark).not.toBeDisabled();

    fireEvent.keyDown(mark, { key: "Tab" });
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "Tab", shiftKey: true });
    expect(mark).toHaveFocus();

    release();
    await waitFor(() => expect(mark).not.toHaveAttribute("aria-busy"));
  });

  it("closes on an outside press without pulling focus back to the bell", async () => {
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    await screen.findByRole("dialog", { name: "最近通知" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const other = screen.getByRole("button", { name: "旁边" });
    other.focus();
    fireEvent.mouseDown(other);
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
    expect(other).toHaveFocus();
  });

  it("returns focus to the bell after the opened detail closes", async () => {
    renderWithRouter(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole("button", { name: /待审批/ }));

    const detail = await screen.findByRole("dialog", { name: "待审批" });
    await waitFor(() => expect(detail).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "待审批" })).not.toBeInTheDocument(),
    );
    expect(bell).toHaveFocus();
  });

  it("toggles the notification panel closed on a second bell click", async () => {
    renderWithRouter(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    expect(await screen.findByRole("dialog", { name: "最近通知" })).toBeInTheDocument();
    expect(await screen.findByText("待审批")).toBeInTheDocument();
    fireEvent.click(bell);
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
  });

  it("shows the empty copy only after a successful read", async () => {
    listNotifications.mockResolvedValue([]);
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByText("暂无通知")).toBeInTheDocument();
    expect(screen.queryByTestId("notifications-load-error")).not.toBeInTheDocument();
  });

  it("shows a loading line instead of an empty notification list", async () => {
    listNotifications.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
  });

  it("shows the notification read failure instead of an empty list", async () => {
    listNotifications.mockRejectedValue(new Error("通知暂时读不到"));
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const alert = await screen.findByTestId("notifications-load-error");
    expect(alert).toHaveTextContent("通知暂时读不到");
    expect(addError).toHaveBeenCalledWith("通知暂时读不到", "通知");
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the bell fallback when the load error has no message", async () => {
    listNotifications.mockRejectedValue(new Error("   "));
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByTestId("notifications-load-error")).toHaveTextContent("加载通知失败");
    expect(addError).toHaveBeenCalledWith("加载通知失败", "通知");
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
  });

  it("keeps the notification retry mounted until the reread finishes", async () => {
    let release: ((rows: unknown[]) => void) | undefined;
    listNotifications.mockRejectedValueOnce(new Error("通知暂时读不到"));
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    listNotifications.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("notifications-load-error")).toHaveTextContent("通知暂时读不到");
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();

    release?.([]);
    expect(await screen.findByText("暂无通知")).toBeInTheDocument();
    expect(screen.queryByTestId("notifications-load-error")).not.toBeInTheDocument();
  });

  it("keeps listed notifications when a later read fails", async () => {
    listNotifications.mockResolvedValueOnce([sample]);
    renderWithRouter(<NotificationBell />);
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    listNotifications.mockRejectedValueOnce(new Error("刷新失败"));
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByText("待审批")).toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notifications-load-error")).not.toBeInTheDocument();
    await waitFor(() => expect(addError).toHaveBeenCalledWith("刷新失败", "通知"));
  });

  it("does not send mark-all again while the first request is in flight", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();

    fireEvent.click(mark);
    fireEvent.click(mark);

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(mark).toHaveAttribute("aria-busy", "true");
    expect(mark).not.toBeDisabled();
    expect(mark).toHaveFocus();
    expect(mark).toHaveClass("opacity-50");

    release();
    await waitFor(() => expect(mark).not.toHaveAttribute("aria-busy"));
    expect(mark).toHaveFocus();
  });

  it("keeps mark-all and reports the failure without dropping focus", async () => {
    markAllNotificationsRead.mockRejectedValueOnce(new Error("   "));
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();

    fireEvent.click(mark);

    await waitFor(() => expect(addError).toHaveBeenCalledWith("标记已读失败", "通知"));
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveFocus();
    expect(mark).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: /待审批/ })).toBeInTheDocument();
  });

  it("moves focus in the same turn 全部已读 leaves after every row is read", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);
    expect(mark).toHaveAttribute("aria-busy", "true");

    listNotifications.mockResolvedValue([{ ...sample, read: 1 }]);
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "全部已读" }),
    );
    await act(async () => {
      release();
    });
    const first = await screen.findByRole("button", { name: /待审批/ });
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(first);
  });

  it("focuses the panel in the same turn 全部已读 leaves no notifications", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);

    listNotifications.mockResolvedValue([]);
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("button", { name: "全部已读" }),
    );
    await act(async () => {
      release();
    });
    const panel = await screen.findByRole("dialog", { name: "最近通知" });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(screen.getByText("暂无通知")).toBeInTheDocument();
    expect(focusWhenGone.read()).toBe(panel);
  });

  it("moves focus to the first notification after every row is read", async () => {
    const release = holdMarkAll();
    const second = { ...sample, id: "n2", title: "另一条", content: "还在" };
    listNotifications.mockResolvedValue([sample, second]);
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);
    expect(mark).toHaveAttribute("aria-busy", "true");

    listNotifications.mockResolvedValue([
      { ...sample, read: 1 },
      { ...second, read: 1 },
    ]);
    release();

    const first = await screen.findByRole("button", { name: /待审批/ });
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /另一条/ })).not.toHaveFocus();
  });

  it("keeps focus on mark-all when a later read still has unread rows", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);

    release();
    await waitFor(() => expect(mark).not.toHaveAttribute("aria-busy"));
    expect(mark).toHaveFocus();
    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it("focuses the panel when mark-all leaves no notifications", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);

    listNotifications.mockResolvedValue([]);
    release();

    const panel = await screen.findByRole("dialog", { name: "最近通知" });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(screen.getByText("暂无通知")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument();
  });

  it("does not pull focus back when it already moved away", async () => {
    const release = holdMarkAll();
    renderWithRouter(
      <>
        <button type="button">旁边</button>
        <NotificationBell />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);

    const other = screen.getByRole("button", { name: "旁边" });
    other.focus();
    listNotifications.mockResolvedValue([{ ...sample, read: 1 }]);
    release();

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument(),
    );
    expect(other).toHaveFocus();
  });

  it("does not restore the panel after it was closed during mark-all", async () => {
    const release = holdMarkAll();
    renderWithRouter(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    const mark = await screen.findByRole("button", { name: "全部已读" });
    mark.focus();
    fireEvent.click(mark);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();

    listNotifications.mockResolvedValue([{ ...sample, read: 1 }]);
    release();
    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });
});
