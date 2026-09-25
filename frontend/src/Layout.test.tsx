import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./Layout";
import ChatHome from "./components/chat/ChatHome";
import { useChatStore } from "./stores/chatStore";
import { useErrorStore } from "./stores/errorStore";

vi.mock("./hooks/useNotifications", async () => {
  const React = await import("react");
  return {
    LiveNotificationContext: React.createContext<unknown[]>([]),
    useNotifications: () => ({
      toasts: [],
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
