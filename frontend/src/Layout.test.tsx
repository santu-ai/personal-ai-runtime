import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
