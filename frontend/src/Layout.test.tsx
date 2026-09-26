import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Layout, { layoutDeleteLayoutFocus, toastStackLayoutFocus } from "./Layout";
import ChatHome from "./components/chat/ChatHome";
import { useChatStore } from "./stores/chatStore";
import { useErrorStore } from "./stores/errorStore";
import { clearToastDismissFocus } from "./utils/toastDismissFocus";

const notificationState = vi.hoisted(() => ({
  toasts: [] as {
    id: string;
    type: string;
    title: string;
    content: string;
    created_at: string;
  }[],
}));

vi.mock("./hooks/useNotifications", async () => {
  const React = await import("react");
  return {
    LiveNotificationContext: React.createContext<unknown[]>([]),
    useNotifications: () => ({
      toasts: notificationState.toasts,
      liveNotifications: [],
      dismissToast: () => {},
    }),
    useLiveNotifications: () => [],
  };
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Layout conversation list", () => {
  let conversationCalls = 0;

  beforeEach(() => {
    conversationCalls = 0;
    localStorage.setItem("onboarding_done", "1");
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      pendingPrompt: null,
    });
    useErrorStore.setState({ errors: [], backendUnavailable: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/chat/conversations")) {
          conversationCalls += 1;
          if (conversationCalls <= 2) {
            return json({ detail: "会话暂时读不到" }, 500);
          }
          return json([]);
        }
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0 });
        if (url.includes("/inbox")) return json([]);
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  it("shows the conversation read failure instead of an empty list, then the empty copy", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const alert = await screen.findByTestId("conversations-load-error", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("会话暂时读不到");
    expect(screen.queryByText("暂无对话")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(await screen.findByText("暂无对话")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-load-error")).not.toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

describe("Layout delete conversation", () => {
  const conversation = {
    id: "c1",
    title: "周末计划",
    summary: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
  let deleteCalls = 0;
  let deleteMode: "hold" | "ok" = "hold";
  let releaseDelete: (response: Response) => void = () => {};

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    deleteCalls = 0;
    deleteMode = "hold";
    releaseDelete = () => {};
    localStorage.setItem("onboarding_done", "1");
    localStorage.removeItem("sidebar_collapsed");
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      pendingPrompt: null,
    });
    useErrorStore.setState({ errors: [], backendUnavailable: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/chat/conversations")) {
          if (method === "DELETE") {
            deleteCalls += 1;
            if (deleteMode === "hold") {
              return new Promise<Response>((resolve) => {
                releaseDelete = resolve;
              });
            }
            return new Response(null, { status: 204 });
          }
          return json([conversation]);
        }
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0 });
        if (url.includes("/inbox")) return json([]);
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  it("keeps the delete dialog open until delete succeeds and ignores dismiss while deleting", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/chat/c1"]}>
          <LocationProbe />
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "周末计划" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
    const dialog = await screen.findByRole("dialog", { name: "删除对话" });
    expect(dialog).toHaveTextContent("周末计划");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除中..." }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);

    const pending = await within(dialog).findByRole("button", { name: "删除中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(deleteCalls).toBe(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    expect(screen.getByRole("link", { name: "周末计划" })).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    releaseDelete(json({ detail: "删不掉" }, 500));
    expect(await screen.findByText("删不掉")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("周末计划");
    expect(within(dialog).getByRole("button", { name: "删除" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "周末计划" })).toBeInTheDocument();

    deleteMode = "ok";
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除对话" })).not.toBeInTheDocument(),
    );
    expect(deleteCalls).toBe(2);
    expect(screen.queryByRole("link", { name: "周末计划" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });
});

describe("Layout delete conversation focus", () => {
  const first = {
    id: "c1",
    title: "周末计划",
    summary: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
  };
  const second = {
    id: "c2",
    title: "读书笔记",
    summary: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };

  function renderLayout(path = "/chat/c1") {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** 确认框卸下的那一轮，绘制前焦点已经在下一行上。useEffect 会先停在页面空白。 */
  function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
    let focusAtLayout: Element | null = null;
    layoutDeleteLayoutFocus.notify = () => {
      if (!gone()) return;
      focusAtLayout ??= document.activeElement;
    };
    return {
      read: () => focusAtLayout,
    };
  }

  beforeEach(() => {
    layoutDeleteLayoutFocus.notify = null;
    localStorage.setItem("onboarding_done", "1");
    localStorage.removeItem("sidebar_collapsed");
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      pendingPrompt: null,
    });
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  function stubConversations(rows: Array<typeof first>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/chat/conversations")) {
          if (method === "DELETE") return new Response(null, { status: 204 });
          return json(rows);
        }
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0 });
        if (url.includes("/inbox")) return json([]);
        return json({});
      }),
    );
  }

  function deleteButton(title: string) {
    const link = screen.getByRole("link", { name: title });
    return within(link.parentElement as HTMLElement).getByRole("button", { name: "删除对话" });
  }

  it("moves focus to the next conversation delete button", async () => {
    stubConversations([first, second]);
    renderLayout();
    await screen.findByRole("link", { name: "读书笔记" });
    const opener = deleteButton("周末计划");
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "删除对话" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("dialog", { name: "删除对话" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除对话" })).not.toBeInTheDocument(),
    );
    const next = deleteButton("读书笔记");
    expect(next).toHaveFocus();
    expect(focusWhenGone.read()).toBe(next);
  });

  it("moves focus to the previous conversation when the last one is deleted", async () => {
    stubConversations([first, second]);
    renderLayout("/chat/c2");
    await screen.findByRole("link", { name: "读书笔记" });
    fireEvent.click(deleteButton("读书笔记"));
    const dialog = await screen.findByRole("dialog", { name: "删除对话" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除对话" })).not.toBeInTheDocument(),
    );
    expect(deleteButton("周末计划")).toHaveFocus();
  });

  it("moves focus to 新对话 when the only conversation is deleted", async () => {
    stubConversations([first]);
    renderLayout();
    await screen.findByRole("link", { name: "周末计划" });
    fireEvent.click(deleteButton("周末计划"));
    const dialog = await screen.findByRole("dialog", { name: "删除对话" });
    within(dialog).getByRole("button", { name: "删除" }).focus();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "周末计划" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "新对话" })).toHaveFocus();
  });

  it("does not pull conversation delete focus back when it already moved", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/chat/conversations")) {
          if (method === "DELETE") {
            return new Promise<Response>((resolve) => {
              release = resolve;
            });
          }
          return json([first, second]);
        }
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0 });
        if (url.includes("/inbox")) return json([]);
        return json({});
      }),
    );
    renderLayout();
    await screen.findByRole("link", { name: "周末计划" });
    fireEvent.click(deleteButton("周末计划"));
    const dialog = await screen.findByRole("dialog", { name: "删除对话" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const goals = screen.getByRole("link", { name: "目标" });
    goals.focus();

    await act(async () => {
      release(new Response(null, { status: 204 }));
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "删除对话" })).not.toBeInTheDocument(),
    );
    expect(goals).toHaveFocus();
  });
});

describe("Layout new chat", () => {
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  let posts = 0;
  let releasePost: (response: Response) => void = () => {};

  beforeEach(() => {
    posts = 0;
    releasePost = () => {};
    localStorage.setItem("onboarding_done", "1");
    localStorage.removeItem("sidebar_collapsed");
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      pendingPrompt: null,
    });
    useErrorStore.setState({ errors: [], backendUnavailable: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/chat/conversations") && init?.method === "POST") {
          posts += 1;
          return new Promise<Response>((resolve) => {
            releasePost = resolve;
          });
        }
        if (url.includes("/chat/conversations")) return json([]);
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0, memories: [] });
        if (url.includes("/inbox")) return json([]);
        if (url.includes("/work-items")) return json([]);
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  function renderLayout() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("does not open a second chat while 新对话 is in flight", async () => {
    renderLayout();
    const button = await screen.findByRole("button", { name: "新对话" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    expect(button).toHaveClass("opacity-50");
    expect(posts).toBe(1);

    const nav = screen.getByRole("link", { name: "概览" });
    nav.focus();
    await act(async () => {
      releasePost(
        json({
          id: "c-new",
          title: null,
          summary: null,
          created_at: "2026-09-25T00:00:00Z",
          updated_at: "2026-09-25T00:00:00Z",
        }),
      );
    });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(nav).toHaveFocus();
    expect(posts).toBe(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c-new");
  });

  it("returns focus to 新对话 when creating the chat fails, and does not steal it", async () => {
    renderLayout();
    const button = await screen.findByRole("button", { name: "新对话" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    (button as HTMLButtonElement).blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(button).toHaveFocus();
    expect(button).toBeEnabled();
    expect(posts).toBe(1);
    expect(await screen.findByText("创建对话失败")).toBeInTheDocument();

    const nav = screen.getByRole("link", { name: "概览" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    nav.focus();
    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(nav).toHaveFocus();
    expect(posts).toBe(2);
  });

  function renderHome() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<ChatHome />} />
              <Route path="/chat/:conversationId" element={<span data-testid="opened-chat" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("does not open another chat from the sidebar while home 发送 is in flight", async () => {
    renderHome();
    const box = await screen.findByPlaceholderText(/输入消息/);
    fireEvent.change(box, { target: { value: "首页这句" } });
    const send = screen.getByRole("button", { name: "发送" });
    const newer = screen.getByRole("button", { name: "新对话" });
    send.focus();
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute("aria-busy", "true"));
    expect(send).toBeEnabled();
    expect(send).toHaveFocus();
    fireEvent.click(newer);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(posts).toBe(1);
    expect(newer).toBeEnabled();
    expect(newer).not.toHaveAttribute("aria-busy");

    const start = await screen.findByRole("button", { name: "开始对话" });
    fireEvent.click(start);
    expect(posts).toBe(1);
    expect(start).not.toHaveAttribute("aria-busy");

    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(send).not.toHaveAttribute("aria-busy"));
    expect(posts).toBe(1);
    expect(box).toHaveValue("首页这句");

    newer.focus();
    fireEvent.click(newer);
    await waitFor(() => expect(newer).toHaveAttribute("aria-busy", "true"));
    expect(posts).toBe(2);
    expect(send).not.toHaveAttribute("aria-busy");
    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(newer).not.toHaveAttribute("aria-busy"));
  });

  it("does not send from home while 新对话 is in flight", async () => {
    renderHome();
    const newer = await screen.findByRole("button", { name: "新对话" });
    const box = await screen.findByPlaceholderText(/输入消息/);
    newer.focus();
    fireEvent.click(newer);
    await waitFor(() => expect(newer).toHaveAttribute("aria-busy", "true"));
    fireEvent.change(box, { target: { value: "首页这句" } });
    const send = screen.getByRole("button", { name: "发送" });
    send.focus();
    fireEvent.click(send);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(posts).toBe(1);
    expect(send).toBeEnabled();
    expect(send).not.toHaveAttribute("aria-busy");
    expect(box).toHaveValue("首页这句");
    expect(send).toHaveFocus();

    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(newer).not.toHaveAttribute("aria-busy"));
    expect(send).toHaveFocus();
    expect(box).toHaveValue("首页这句");

    send.focus();
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute("aria-busy", "true"));
    expect(posts).toBe(2);
    expect(newer).not.toHaveAttribute("aria-busy");
    await act(async () => {
      releasePost(json({ detail: "创建对话失败" }, 500));
    });
    await waitFor(() => expect(send).not.toHaveAttribute("aria-busy"));
    expect(box).toHaveValue("首页这句");
  });
});

describe("Layout toast focus", () => {
  function renderLayout() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function captureFocusWhenGone(gone: () => boolean): { read: () => Element | null } {
    let focusAtLayout: Element | null = null;
    toastStackLayoutFocus.notify = () => {
      if (!gone()) return;
      focusAtLayout ??= document.activeElement;
    };
    return { read: () => focusAtLayout };
  }

  beforeEach(() => {
    notificationState.toasts = [];
    toastStackLayoutFocus.notify = null;
    clearToastDismissFocus();
    localStorage.setItem("onboarding_done", "1");
    localStorage.removeItem("sidebar_collapsed");
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      pendingPrompt: null,
    });
    useErrorStore.setState({ errors: [], backendUnavailable: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/chat/conversations")) return json([]);
        if (url.includes("/notifications")) return json([]);
        if (url.includes("/system/health")) return json({ auth_required: false });
        if (url.includes("/approvals")) return json([]);
        if (url.includes("/memory")) return json({ count: 0 });
        if (url.includes("/inbox")) return json([]);
        return json({});
      }),
    );
  });

  afterEach(() => {
    toastStackLayoutFocus.notify = null;
    notificationState.toasts = [];
    clearToastDismissFocus();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  it("moves error-toast focus to the next close button in the same layout turn", async () => {
    renderLayout();
    await screen.findByRole("button", { name: "通知" });
    act(() => {
      useErrorStore.getState().addError("先到", "收件箱");
      useErrorStore.getState().addError("后到", "任务");
    });
    const close = screen.getAllByRole("button", { name: "关闭" })[0];
    expect(close).toBeDefined();
    close?.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("后到"));
    fireEvent.click(close!);
    const remaining = screen.getByRole("button", { name: "关闭" });
    expect(remaining).toHaveFocus();
    expect(focusWhenGone.read()).toBe(remaining);
    expect(screen.getByText("先到")).toBeInTheDocument();
  });

  it("moves the last error toast focus to the notification bell", async () => {
    renderLayout();
    const bell = await screen.findByRole("button", { name: "通知" });
    act(() => {
      useErrorStore.getState().addError("只有这条");
    });
    const close = screen.getByRole("button", { name: "关闭" });
    close.focus();
    const focusWhenGone = captureFocusWhenGone(() => !screen.queryByText("只有这条"));
    fireEvent.click(close);
    expect(bell).toHaveFocus();
    expect(focusWhenGone.read()).toBe(bell);
  });

  it("returns focus to the notification bell when a live notice detail closes", async () => {
    notificationState.toasts = [
      {
        id: "live-1",
        type: "reminder",
        title: "喝水",
        content: "该喝了",
        created_at: "2026-09-26T00:00:00.000Z",
      },
    ];
    renderLayout();
    const bell = await screen.findByRole("button", { name: "通知" });
    fireEvent.click(screen.getByRole("button", { name: /喝水/ }));
    expect(await screen.findByRole("dialog", { name: "喝水" })).toBeInTheDocument();
    const focusWhenGone = captureFocusWhenGone(
      () => !screen.queryByRole("dialog", { name: "喝水" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "喝水" })).not.toBeInTheDocument(),
    );
    expect(bell).toHaveFocus();
    expect(focusWhenGone.read()).toBe(bell);
  });
});
