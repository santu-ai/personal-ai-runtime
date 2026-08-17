import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import NotificationBell from "./NotificationBell";

vi.mock("../../hooks/useNotificationsQuery", () => ({
  useNotificationsQuery: () => ({
    data: [
      {
        id: "n1",
        title: "待审批",
        content: "写入文件需要确认",
        type: "approval",
        read: 0,
        created_at: "2026-08-17T10:00:00Z",
      },
    ],
    refetch: vi.fn(),
  }),
  useInvalidateNotifications: () => vi.fn(),
}));

vi.mock("../../api/client", () => ({
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles the notification panel closed on a second bell click", () => {
    renderWithRouter(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "通知" });
    fireEvent.click(bell);
    expect(screen.getByRole("dialog", { name: "最近通知" })).toBeInTheDocument();
    fireEvent.click(bell);
    expect(screen.queryByRole("dialog", { name: "最近通知" })).not.toBeInTheDocument();
  });
});
