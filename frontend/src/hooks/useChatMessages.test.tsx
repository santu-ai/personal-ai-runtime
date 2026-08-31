import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { getMessages, sendMessage } from "../api/client";
import type { Message } from "../api/types";
import { useChatMessages } from "./useChatMessages";

vi.mock("../api/client", () => ({
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  cancelChat: vi.fn().mockResolvedValue({ status: "ok", cancelled: 0 }),
  updateConversation: vi.fn().mockResolvedValue({ status: "ok" }),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const chatStoreState = {
  conversations: [] as Array<{ id: string; title: string }>,
  pendingPrompt: null as string | null,
  setPendingPrompt: vi.fn(),
  updateConversationTitle: vi.fn(),
};

vi.mock("../stores/chatStore", () => {
  const useChatStore = Object.assign(
    (selector: (s: typeof chatStoreState) => unknown) => selector(chatStoreState),
    { getState: () => chatStoreState },
  );
  return { useChatStore };
});

function msg(id: string, content: string, role = "user"): Message {
  return {
    id,
    conversation_id: "conv-test",
    role,
    content,
    tool_calls: null,
    tool_call_id: null,
    created_at: "2026-08-31T00:00:00Z",
  };
}

function Harness({ conversationId }: { conversationId: string }) {
  const { messages, messagesHydrated, handleSend } = useChatMessages(conversationId);
  return (
    <div>
      <div data-testid="hydrated">{String(messagesHydrated)}</div>
      <ul data-testid="messages">
        {messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            {m.content}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void handleSend("from-b")}>
        send
      </button>
    </div>
  );
}

function Switcher() {
  const [id, setId] = useState("conv-a");
  return (
    <div>
      <button type="button" onClick={() => setId("conv-b")}>
        switch-b
      </button>
      <Harness conversationId={id} />
    </div>
  );
}

function renderHarness(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useChatMessages conversation switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatStoreState.conversations = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("clears A and shows only B after a delayed B load", async () => {
    const bLoad = deferred<Message[]>();
    vi.mocked(getMessages).mockImplementation(async (id: string) => {
      if (id === "conv-a") return [msg("a1", "from-a")];
      return bLoad.promise;
    });

    renderHarness(<Switcher />);
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());

    fireEvent.click(screen.getByText("switch-b"));
    await waitFor(() => expect(screen.queryByText("from-a")).not.toBeInTheDocument());
    expect(screen.getByTestId("messages").textContent).toBe("");

    await act(async () => {
      bLoad.resolve([msg("b1", "from-b-history")]);
    });
    await waitFor(() => expect(screen.getByText("from-b-history")).toBeInTheDocument());
    expect(screen.queryByText("from-a")).not.toBeInTheDocument();
  });

  it("ignores a stale A response that arrives after switching to B", async () => {
    const aLoad = deferred<Message[]>();
    vi.mocked(getMessages).mockImplementation(async (id: string) => {
      if (id === "conv-a") return aLoad.promise;
      return [msg("b1", "from-b-history")];
    });

    renderHarness(<Switcher />);
    fireEvent.click(screen.getByText("switch-b"));
    await waitFor(() => expect(screen.getByText("from-b-history")).toBeInTheDocument());

    await act(async () => {
      aLoad.resolve([msg("a1", "from-a-late")]);
    });
    expect(screen.queryByText("from-a-late")).not.toBeInTheDocument();
    expect(screen.getByText("from-b-history")).toBeInTheDocument();
  });

  it("keeps the in-flight B send instead of letting delayed hydrate overwrite it", async () => {
    const bLoad = deferred<Message[]>();
    vi.mocked(getMessages).mockImplementation(async (id: string) => {
      if (id === "conv-a") return [msg("a1", "from-a")];
      return bLoad.promise;
    });
    vi.mocked(sendMessage).mockImplementation(async (_id, _text, _onEvent, _onError, onDone) => {
      onDone();
    });

    renderHarness(<Switcher />);
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());
    fireEvent.click(screen.getByText("switch-b"));
    await waitFor(() => expect(screen.queryByText("from-a")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByText("from-b")).toBeInTheDocument());

    await act(async () => {
      bLoad.resolve([msg("b1", "from-b-history")]);
    });
    expect(screen.getByText("from-b")).toBeInTheDocument();
    expect(screen.queryByText("from-a")).not.toBeInTheDocument();
    expect(screen.queryByText("from-b-history")).not.toBeInTheDocument();
  });

  it("does not apply history after unmount", async () => {
    const load = deferred<Message[]>();
    vi.mocked(getMessages).mockReturnValue(load.promise);

    const { unmount } = renderHarness(<Harness conversationId="conv-a" />);
    unmount();
    await act(async () => {
      load.resolve([msg("a1", "from-a")]);
    });
    expect(screen.queryByText("from-a")).not.toBeInTheDocument();
  });
});
