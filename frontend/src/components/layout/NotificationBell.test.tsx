import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import NotificationBell from "./NotificationBell";

const { listNotifications, addError } = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  addError: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  listNotifications,
  markAllNotificationsRead: vi.fn(),
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

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNotifications.mockResolvedValue([sample]);
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
});
