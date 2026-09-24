import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import Layout from "./Layout";
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
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    expect(cancel).toBeDisabled();
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
