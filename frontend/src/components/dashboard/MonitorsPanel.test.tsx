import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import MonitorsPanel from "./MonitorsPanel";
import { ApiError } from "../../api/core";
import { listInboxFilters, listUrlMonitors } from "../../api/monitors";

const { addError } = vi.hoisted(() => ({ addError: vi.fn() }));

vi.mock("../../api/monitors", () => ({
  listInboxFilters: vi.fn().mockResolvedValue([]),
  listUrlMonitors: vi.fn().mockResolvedValue([]),
  createInboxFilter: vi.fn(),
  createUrlMonitor: vi.fn(),
  deleteInboxFilter: vi.fn(),
  deleteUrlMonitor: vi.fn(),
  updateInboxFilter: vi.fn(),
  updateUrlMonitor: vi.fn(),
  checkUrlMonitors: vi.fn(),
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: typeof addError }) => unknown) =>
    selector({ addError }),
}));

describe("MonitorsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listInboxFilters).mockResolvedValue([]);
    vi.mocked(listUrlMonitors).mockResolvedValue([]);
  });

  it("shows empty rules after a successful read", async () => {
    renderWithRouter(<MonitorsPanel />);
    expect(await screen.findByText("暂无邮件规则")).toBeInTheDocument();
    expect(screen.getByText("暂无网页监控")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retry when monitor rules fail to load", async () => {
    vi.mocked(listInboxFilters).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<MonitorsPanel />);
    const alert = await screen.findByTestId("monitors-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(addError).toHaveBeenCalledWith("加载失败", "监控");
    expect(screen.queryByText("暂无邮件规则")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无网页监控")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the page fallback when the monitor error has no message", async () => {
    vi.mocked(listUrlMonitors).mockRejectedValue(new ApiError("   ", 500));
    renderWithRouter(<MonitorsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("加载监控规则失败");
    expect(screen.queryByText("暂无邮件规则")).not.toBeInTheDocument();
  });

  it("keeps the monitor retry mounted until the reread finishes", async () => {
    vi.mocked(listInboxFilters).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<MonitorsPanel />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    let releaseFilters: (() => void) | undefined;
    vi.mocked(listInboxFilters).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFilters = () => resolve([]);
        }),
    );
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByTestId("monitors-load-error")).toHaveTextContent("加载失败");
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无邮件规则")).not.toBeInTheDocument();

    releaseFilters?.();
    expect(await screen.findByText("暂无邮件规则")).toBeInTheDocument();
    expect(screen.queryByTestId("monitors-load-error")).not.toBeInTheDocument();
  });
});
