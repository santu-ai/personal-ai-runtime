import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import NotificationDetailModal from "./NotificationDetailModal";
import type { Notification } from "../../api/client";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const sampleNotification: Notification = {
  id: "n1",
  type: "goal_stagnant",
  title: "目标提醒",
  content: "你的目标本周无进展",
  created_at: "2026-06-10T08:00:00Z",
};

describe("NotificationDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders null when notification is null", () => {
    const { container } = renderWithRouter(
      <NotificationDetailModal notification={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows title, type label and content", () => {
    renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={vi.fn()} />,
    );
    expect(screen.getByText("目标提醒")).toBeInTheDocument();
    expect(screen.getByText("目标")).toBeInTheDocument();
    expect(screen.getByText("你的目标本周无进展")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={onClose} />,
    );
    const close = screen.getByLabelText("关闭");
    expect(close.querySelector("[data-icon-name]")).toHaveTextContent("关闭");
    expect(close.querySelector("[data-icon-name]")).toHaveClass(
      "hidden",
      "group-focus-visible:block",
    );
    expect(close.querySelector("[aria-hidden]")).toHaveClass("group-focus-visible:hidden");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("目标提醒").closest(".fixed")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when content area clicked", () => {
    const onClose = vi.fn();
    renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("你的目标本周无进展"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navigates to related page", () => {
    const onClose = vi.fn();
    renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("查看相关页面"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith("/goals");
  });

  it("labels a reminder in Chinese", () => {
    renderWithRouter(
      <NotificationDetailModal
        notification={{ ...sampleNotification, type: "reminder", title: "喝水" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("提醒")).toBeInTheDocument();
    expect(screen.queryByText("reminder")).not.toBeInTheDocument();
  });

  it("moves focus into the dialog and returns it after close", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "打开提醒";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = renderWithRouter(
      <NotificationDetailModal notification={sampleNotification} onClose={onClose} />,
    );
    const dialog = screen.getByRole("dialog", { name: "目标提醒" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(<NotificationDetailModal notification={null} onClose={onClose} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("opens the same task when a reminder names that work item", () => {
    const onClose = vi.fn();
    const reminder: Notification = {
      ...sampleNotification,
      type: "reminder",
      title: "提醒",
      related_type: "work_item",
      related_id: "brief_1",
    };
    renderWithRouter(<NotificationDetailModal notification={reminder} onClose={onClose} />);
    fireEvent.click(screen.getByText("查看相关页面"));
    expect(mockNavigate).toHaveBeenCalledWith("/tasks/brief_1");
  });

  it("navigates to dashboard for generic notification type", () => {
    const onClose = vi.fn();
    const generic: Notification = {
      ...sampleNotification,
      type: "custom_unknown_type",
    };
    renderWithRouter(<NotificationDetailModal notification={generic} onClose={onClose} />);
    fireEvent.click(screen.getByText("查看相关页面"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
  });
});
