import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import MonitorsPanel from "./MonitorsPanel";
import { ApiError } from "../../api/core";
import {
  checkUrlMonitors,
  createInboxFilter,
  createUrlMonitor,
  deleteInboxFilter,
  deleteUrlMonitor,
  listInboxFilters,
  listUrlMonitors,
  updateInboxFilter,
  type InboxFilter,
  type UrlMonitor,
} from "../../api/monitors";

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

  function inboxFilter(id: string, name: string, enabled = true): InboxFilter {
    return {
      id,
      enabled,
      name,
      sender_contains: "boss@example.com",
      subject_contains: "",
    };
  }

  function urlMonitor(id: string, name: string, enabled = true): UrlMonitor {
    return {
      id,
      enabled,
      name,
      url: `https://example.com/${id}`,
      check_interval_minutes: 60,
    };
  }

  function rowOf(label: string): HTMLElement {
    const row = screen.getByText(label).closest("li");
    if (!row) throw new Error(`missing row for ${label}`);
    return row;
  }

  async function renderLoaded(inbox: InboxFilter[], urls: UrlMonitor[] = []) {
    vi.mocked(listInboxFilters).mockImplementation(async () => inbox.map((row) => ({ ...row })));
    vi.mocked(listUrlMonitors).mockImplementation(async () => urls.map((row) => ({ ...row })));
    renderWithRouter(<MonitorsPanel />);
    if (inbox.length > 0) {
      expect(await screen.findByText(inbox[0].name)).toBeInTheDocument();
    } else {
      expect(await screen.findByText("暂无邮件规则")).toBeInTheDocument();
    }
  }

  it("adds an inbox filter from Enter, and ignores IME and a second press", async () => {
    const inbox: InboxFilter[] = [];
    await renderLoaded(inbox);
    const name = screen.getByPlaceholderText("名称（如：老板）");
    const sender = screen.getByPlaceholderText("发件人包含（可空）");
    const urlName = screen.getByPlaceholderText("名称（如：发布说明）");
    fireEvent.change(name, { target: { value: "老板" } });
    name.focus();
    fireEvent.keyDown(name, { key: "Enter", isComposing: true });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(createInboxFilter).not.toHaveBeenCalled();

    fireEvent.change(sender, { target: { value: "boss" } });
    fireEvent.change(urlName, { target: { value: "发布说明" } });
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "https://example.com/notes" },
    });
    let release: (row: InboxFilter) => void = () => {};
    vi.mocked(createInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (row) => {
            inbox.push(row);
            resolve(row);
          };
        }),
    );
    sender.focus();
    fireEvent.keyDown(sender, { key: "Enter" });
    fireEvent.keyDown(sender, { key: "Enter" });
    fireEvent.keyDown(urlName, { key: "Enter" });

    await waitFor(() => expect(createInboxFilter).toHaveBeenCalledTimes(1));
    expect(createInboxFilter).toHaveBeenCalledWith({
      name: "老板",
      sender_contains: "boss",
      subject_contains: "",
    });
    expect(createUrlMonitor).not.toHaveBeenCalled();
    expect(sender).toHaveFocus();
    expect(screen.getByRole("button", { name: "添加过滤器" })).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      release(inboxFilter("if_new", "老板"));
    });
    expect(await screen.findByText("老板")).toBeInTheDocument();
    expect(sender).toHaveFocus();
    expect(name).toHaveValue("");
    expect(sender).toHaveValue("");
  });

  it("adds a url monitor from Enter, and ignores IME and an incomplete form", async () => {
    const urls: UrlMonitor[] = [];
    await renderLoaded([], urls);
    const urlName = screen.getByPlaceholderText("名称（如：发布说明）");
    const urlValue = screen.getByPlaceholderText("https://…");
    const interval = screen.getByPlaceholderText("检查间隔（分钟，最少 30）");
    fireEvent.change(urlName, { target: { value: "发布说明" } });
    urlName.focus();
    fireEvent.keyDown(urlName, { key: "Enter", isComposing: true });
    fireEvent.keyDown(urlName, { key: "Enter" });
    expect(createUrlMonitor).not.toHaveBeenCalled();

    fireEvent.change(urlValue, { target: { value: "https://example.com/notes" } });
    fireEvent.change(interval, { target: { value: "90" } });
    let release: (row: UrlMonitor) => void = () => {};
    vi.mocked(createUrlMonitor).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (row) => {
            urls.push(row);
            resolve(row);
          };
        }),
    );
    interval.focus();
    fireEvent.keyDown(interval, { key: "Enter" });
    fireEvent.keyDown(interval, { key: "Enter" });

    await waitFor(() => expect(createUrlMonitor).toHaveBeenCalledTimes(1));
    expect(createUrlMonitor).toHaveBeenCalledWith({
      name: "发布说明",
      url: "https://example.com/notes",
      check_interval_minutes: 90,
    });
    expect(interval).toHaveFocus();
    expect(screen.getByRole("button", { name: "添加网页监控" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await act(async () => {
      release(urlMonitor("um_new", "发布说明"));
    });
    expect(await screen.findByText("发布说明")).toBeInTheDocument();
    expect(interval).toHaveFocus();
    expect(urlName).toHaveValue("");
    expect(urlValue).toHaveValue("");
    expect(interval).toHaveValue("60");
  });

  it("does not send a second inbox filter, keeps focus, then moves it to 停用", async () => {
    const inbox = [inboxFilter("if_a", "已有")];
    const urls = [urlMonitor("um_a", "发布页")];
    await renderLoaded(inbox, urls);
    let release: (row: InboxFilter) => void = () => {};
    vi.mocked(createInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (row) => {
            inbox.push(row);
            resolve(row);
          };
        }),
    );

    fireEvent.change(screen.getByPlaceholderText("名称（如：老板）"), {
      target: { value: "老板" },
    });
    fireEvent.change(screen.getByPlaceholderText("发件人包含（可空）"), {
      target: { value: "boss" },
    });
    fireEvent.change(screen.getByPlaceholderText("名称（如：发布说明）"), {
      target: { value: "发布说明" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "https://example.com/notes" },
    });
    const add = screen.getByRole("button", { name: "添加过滤器" });
    add.focus();
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(within(rowOf("已有")).getByRole("button", { name: "停用" }));
    fireEvent.click(within(rowOf("已有")).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "立即检查" }));
    fireEvent.click(screen.getByRole("button", { name: "添加网页监控" }));

    await waitFor(() => expect(add).toHaveAttribute("aria-busy", "true"));
    expect(add).not.toBeDisabled();
    expect(add).toHaveFocus();
    expect(add).toHaveClass("opacity-50");
    expect(within(rowOf("已有")).getByRole("button", { name: "停用" })).not.toHaveAttribute(
      "aria-busy",
    );
    expect(createInboxFilter).toHaveBeenCalledTimes(1);
    expect(createInboxFilter).toHaveBeenCalledWith({
      name: "老板",
      sender_contains: "boss",
      subject_contains: "",
    });
    expect(updateInboxFilter).not.toHaveBeenCalled();
    expect(deleteInboxFilter).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(checkUrlMonitors).not.toHaveBeenCalled();
    expect(createUrlMonitor).not.toHaveBeenCalled();

    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!add.hasAttribute("disabled")) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(add, { attributes: true, attributeFilter: ["disabled"] });
    await act(async () => {
      release(inboxFilter("if_new", "老板"));
    });
    const created = await screen.findByText("老板");
    const toggle = within(created.closest("li") as HTMLElement).getByRole("button", {
      name: "停用",
    });
    expect(focusWhenDisabled).toBe(toggle);
    expect(add).toBeDisabled();
    expect(toggle).toHaveFocus();
    observer.disconnect();
    expect(screen.getByPlaceholderText("名称（如：老板）")).toHaveValue("");
    expect(screen.getByPlaceholderText("发件人包含（可空）")).toHaveValue("");
  });

  it("keeps the filter draft and focus when creating a filter fails", async () => {
    await renderLoaded([]);
    vi.mocked(createInboxFilter).mockRejectedValue(new ApiError("创建失败", 400));
    fireEvent.change(screen.getByPlaceholderText("名称（如：老板）"), {
      target: { value: "老板" },
    });
    fireEvent.change(screen.getByPlaceholderText("发件人包含（可空）"), {
      target: { value: "boss" },
    });
    fireEvent.change(screen.getByPlaceholderText("主题包含（可空）"), {
      target: { value: "周报" },
    });
    const add = screen.getByRole("button", { name: "添加过滤器" });
    add.focus();
    fireEvent.click(add);
    fireEvent.click(add);

    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建失败", "监控"));
    expect(createInboxFilter).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("名称（如：老板）")).toHaveValue("老板");
    expect(screen.getByPlaceholderText("发件人包含（可空）")).toHaveValue("boss");
    expect(screen.getByPlaceholderText("主题包含（可空）")).toHaveValue("周报");
    expect(add).toHaveFocus();
    expect(add).not.toBeDisabled();
    expect(add).not.toHaveAttribute("aria-busy");
  });

  it("does not pull focus back after a filter is created if it already moved", async () => {
    const inbox = [inboxFilter("if_a", "已有")];
    await renderLoaded(inbox);
    let release: (row: InboxFilter) => void = () => {};
    vi.mocked(createInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (row) => {
            inbox.push(row);
            resolve(row);
          };
        }),
    );
    fireEvent.change(screen.getByPlaceholderText("名称（如：老板）"), {
      target: { value: "老板" },
    });
    fireEvent.change(screen.getByPlaceholderText("发件人包含（可空）"), {
      target: { value: "boss" },
    });
    const add = screen.getByRole("button", { name: "添加过滤器" });
    add.focus();
    fireEvent.click(add);
    const keep = within(rowOf("已有")).getByRole("button", { name: "删除" });
    keep.focus();

    await act(async () => {
      release(inboxFilter("if_new", "老板"));
    });
    expect(await screen.findByText("老板")).toBeInTheDocument();
    await waitFor(() => expect(add).not.toHaveAttribute("aria-busy"));
    expect(keep).toHaveFocus();
  });

  it("does not send a second toggle and keeps focus on 启用", async () => {
    const inbox = [inboxFilter("if_a", "已有")];
    await renderLoaded(inbox);
    let release: (row: InboxFilter) => void = () => {};
    vi.mocked(updateInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const toggle = within(rowOf("已有")).getByRole("button", { name: "停用" });
    const remove = within(rowOf("已有")).getByRole("button", { name: "删除" });
    toggle.focus();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(remove);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveFocus();
    expect(updateInboxFilter).toHaveBeenCalledTimes(1);
    expect(updateInboxFilter).toHaveBeenCalledWith("if_a", { enabled: false });
    expect(deleteInboxFilter).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    inbox[0] = { ...inbox[0], enabled: false };
    await act(async () => {
      release(inbox[0]);
    });
    await waitFor(() =>
      expect(within(rowOf("已有")).getByRole("button", { name: "启用" })).toHaveFocus(),
    );
    expect(rowOf("已有")).toHaveTextContent("已停用");
  });

  it("does not delete a filter until confirm, and Escape returns to the row", async () => {
    await renderLoaded([inboxFilter("if_a", "甲")]);
    const remove = within(rowOf("甲")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    expect(dialog).toHaveTextContent("确定删除收件箱过滤器「甲」？此操作不可撤销。");
    expect(deleteInboxFilter).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(remove).toHaveFocus();
    expect(deleteInboxFilter).not.toHaveBeenCalled();
    expect(screen.getByText("甲")).toBeInTheDocument();
  });

  it("moves focus to the next filter delete button", async () => {
    const inbox = [inboxFilter("if_a", "甲"), inboxFilter("if_b", "乙")];
    await renderLoaded(inbox);
    let release: () => void = () => {};
    vi.mocked(deleteInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            inbox.splice(0, 1);
            resolve();
          };
        }),
    );
    const remove = within(rowOf("甲")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    confirm.focus();
    fireEvent.click(confirm);
    fireEvent.click(within(dialog).getByRole("button", { name: "删除中..." }));
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(rowOf("乙")).getByRole("button", { name: "停用" }));
    fireEvent.click(remove);

    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "取消" })).not.toBeDisabled();
    expect(dialog).toBeInTheDocument();
    expect(deleteInboxFilter).toHaveBeenCalledTimes(1);
    expect(deleteInboxFilter).toHaveBeenCalledWith("if_a");
    expect(updateInboxFilter).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByText("甲")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(rowOf("乙")).getByRole("button", { name: "删除" })).toHaveFocus();
  });

  it("moves focus to the previous filter delete button when the last row goes", async () => {
    const inbox = [inboxFilter("if_a", "甲"), inboxFilter("if_b", "乙")];
    await renderLoaded(inbox);
    let release: () => void = () => {};
    vi.mocked(deleteInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            inbox.splice(1, 1);
            resolve();
          };
        }),
    );
    const remove = within(rowOf("乙")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    confirm.focus();
    fireEvent.click(confirm);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByText("乙")).not.toBeInTheDocument());
    expect(within(rowOf("甲")).getByRole("button", { name: "删除" })).toHaveFocus();
  });

  it("moves focus to the filter name when the only filter is deleted", async () => {
    const inbox = [inboxFilter("if_a", "甲")];
    await renderLoaded(inbox);
    let release: () => void = () => {};
    vi.mocked(deleteInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            inbox.splice(0, 1);
            resolve();
          };
        }),
    );
    const remove = within(rowOf("甲")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    confirm.focus();
    fireEvent.click(confirm);

    await act(async () => {
      release();
    });
    expect(await screen.findByText("暂无邮件规则")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("名称（如：老板）")).toHaveFocus();
  });

  it("keeps the delete dialog and focus when a filter delete fails", async () => {
    await renderLoaded([inboxFilter("if_a", "甲")]);
    vi.mocked(deleteInboxFilter).mockRejectedValue(new ApiError("删除失败", 500));
    const remove = within(rowOf("甲")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    confirm.focus();
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(addError).toHaveBeenCalledWith("删除失败", "监控"));
    expect(deleteInboxFilter).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("甲");
    expect(screen.getByText("甲")).toBeInTheDocument();
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveTextContent("删除");
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(confirm).not.toBeDisabled();
  });

  it("does not steal focus after a filter delete succeeds", async () => {
    const inbox = [inboxFilter("if_a", "甲"), inboxFilter("if_b", "乙")];
    await renderLoaded(inbox);
    let release: () => void = () => {};
    vi.mocked(deleteInboxFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            inbox.splice(0, 1);
            resolve();
          };
        }),
    );
    fireEvent.click(within(rowOf("甲")).getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "删除收件箱过滤器" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const name = screen.getByPlaceholderText("名称（如：老板）");
    name.focus();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByText("甲")).not.toBeInTheDocument());
    expect(name).toHaveFocus();
    expect(within(rowOf("乙")).getByRole("button", { name: "删除" })).not.toHaveFocus();
  });

  it("does not check twice, blocks adding a page, and keeps focus on 立即检查", async () => {
    await renderLoaded([], [urlMonitor("um_a", "发布页")]);
    let release: (result: { notified: number }) => void = () => {};
    vi.mocked(checkUrlMonitors).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.change(screen.getByPlaceholderText("名称（如：发布说明）"), {
      target: { value: "发布说明" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "https://example.com/notes" },
    });
    const check = screen.getByRole("button", { name: "立即检查" });
    check.focus();
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(screen.getByRole("button", { name: "添加网页监控" }));
    fireEvent.click(within(rowOf("发布页")).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(check).toHaveAttribute("aria-busy", "true"));
    expect(check).not.toBeDisabled();
    expect(check).toHaveFocus();
    expect(checkUrlMonitors).toHaveBeenCalledTimes(1);
    expect(checkUrlMonitors).toHaveBeenCalledWith(true);
    expect(createUrlMonitor).not.toHaveBeenCalled();
    expect(deleteUrlMonitor).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      release({ notified: 2 });
    });
    expect(await screen.findByText("检查完成：2 处有更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即检查" })).toHaveFocus();
  });

  it("moves focus to 停用 after a url monitor is added and keeps the draft when it fails", async () => {
    const urls: UrlMonitor[] = [];
    await renderLoaded([], urls);
    vi.mocked(createUrlMonitor).mockRejectedValueOnce(new ApiError("创建失败", 400));
    fireEvent.change(screen.getByPlaceholderText("名称（如：发布说明）"), {
      target: { value: "发布说明" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://…"), {
      target: { value: "https://example.com/notes" },
    });
    fireEvent.change(screen.getByPlaceholderText("检查间隔（分钟，最少 30）"), {
      target: { value: "90" },
    });
    const add = screen.getByRole("button", { name: "添加网页监控" });
    add.focus();
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建失败", "监控"));
    expect(createUrlMonitor).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("名称（如：发布说明）")).toHaveValue("发布说明");
    expect(screen.getByPlaceholderText("https://…")).toHaveValue("https://example.com/notes");
    expect(screen.getByPlaceholderText("检查间隔（分钟，最少 30）")).toHaveValue("90");
    expect(add).toHaveFocus();
    expect(add).not.toHaveAttribute("aria-busy");

    let release: (row: UrlMonitor) => void = () => {};
    vi.mocked(createUrlMonitor).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = (row) => {
            urls.push(row);
            resolve(row);
          };
        }),
    );
    fireEvent.change(screen.getByPlaceholderText("名称（如：老板）"), {
      target: { value: "老板" },
    });
    fireEvent.change(screen.getByPlaceholderText("发件人包含（可空）"), {
      target: { value: "boss" },
    });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "添加过滤器" }));
    await waitFor(() => expect(add).toHaveAttribute("aria-busy", "true"));
    expect(createUrlMonitor).toHaveBeenCalledTimes(2);
    expect(createInboxFilter).not.toHaveBeenCalled();

    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!add.hasAttribute("disabled")) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(add, { attributes: true, attributeFilter: ["disabled"] });
    await act(async () => {
      release(urlMonitor("um_new", "发布说明"));
    });
    const created = await screen.findByText("发布说明");
    const toggle = within(created.closest("li") as HTMLElement).getByRole("button", {
      name: "停用",
    });
    expect(focusWhenDisabled).toBe(toggle);
    expect(add).toBeDisabled();
    expect(toggle).toHaveFocus();
    observer.disconnect();
    expect(screen.getByPlaceholderText("名称（如：发布说明）")).toHaveValue("");
    expect(screen.getByPlaceholderText("https://…")).toHaveValue("");
    expect(screen.getByPlaceholderText("检查间隔（分钟，最少 30）")).toHaveValue("60");
  });

  it("moves focus to the next page monitor delete button", async () => {
    const urls = [urlMonitor("um_a", "甲页"), urlMonitor("um_b", "乙页")];
    await renderLoaded([], urls);
    let release: () => void = () => {};
    vi.mocked(deleteUrlMonitor).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            urls.splice(0, 1);
            resolve();
          };
        }),
    );
    const remove = within(rowOf("甲页")).getByRole("button", { name: "删除" });
    remove.focus();
    fireEvent.click(remove);
    const dialog = await screen.findByRole("dialog", { name: "删除网页监控" });
    expect(dialog).toHaveTextContent("确定删除网页监控「甲页」？此操作不可撤销。");
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    confirm.focus();
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByText("甲页")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(rowOf("乙页")).getByRole("button", { name: "删除" })).toHaveFocus();
    expect(deleteUrlMonitor).toHaveBeenCalledTimes(1);
    expect(deleteUrlMonitor).toHaveBeenCalledWith("um_a");
  });
});
