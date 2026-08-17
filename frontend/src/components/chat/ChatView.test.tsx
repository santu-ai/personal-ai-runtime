import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatView from "./ChatView";
import { getMessages, resolveApproval, sendMessage, ratifyMemory } from "../../api/client";

vi.mock("../../api/client", () => ({
  getMessages: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn(),
  resolveApproval: vi.fn(),
  updateConversation: vi.fn().mockResolvedValue({ status: "ok" }),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listMemoriesGrouped: vi.fn().mockResolvedValue({ memories: [] }),
  searchMemories: vi.fn().mockResolvedValue([]),
  ratifyMemory: vi.fn().mockResolvedValue({ status: "ok", claim_status: "ratified" }),
  rejectMemory: vi.fn().mockResolvedValue({ status: "ok", claim_status: "rejected" }),
  getCapabilityPolicy: vi.fn().mockResolvedValue({
    auto_allow: ["read_file"],
    needs_user: ["write_file", "apply_patch", "send_email"],
    forbidden: ["shell_exec"],
    external_ingestion: [],
  }),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../../api/workItems", () => ({
  listWorkItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
}));

const chatStoreState = {
  conversations: [] as Array<{ id: string; title: string }>,
  updateConversationTitle: vi.fn(),
  setConversations: vi.fn((convs: Array<{ id: string; title: string }>) => {
    chatStoreState.conversations = convs;
  }),
  pendingPrompt: null as string | null,
  setPendingPrompt: vi.fn((prompt: string | null) => {
    chatStoreState.pendingPrompt = prompt;
  }),
};

vi.mock("../../stores/chatStore", () => {
  const useChatStore = Object.assign(
    (selector: (s: typeof chatStoreState) => unknown) => selector(chatStoreState),
    { getState: () => chatStoreState },
  );
  return { useChatStore };
});

// TanStack Query-backed hook — provide a controllable stub so component
// tests can drive the memory cache (total + recent slice) and verify the
// "I just remembered" toast logic without a QueryClientProvider.
const memoriesState = {
  data: {
    memories: [] as Array<{ id?: string; content: string }>,
    recent: [] as Array<{ id?: string; content: string }>,
  },
};
const proposedCountState = { data: 0 };
const approvalsState = { data: [] as Array<Record<string, unknown>> };
vi.mock("../../hooks/useMemoriesQuery", () => ({
  useMemoriesGroupedQuery: () => memoriesState,
  useProposedMemoryCountQuery: () => proposedCountState,
}));

vi.mock("../../hooks/useApprovalsQuery", () => ({
  useApprovalsQuery: () => approvalsState,
}));

vi.mock("../../hooks/useSettingsQuery", () => ({
  useCapabilityPolicyQuery: () => ({
    data: {
      auto_allow: ["read_file"],
      needs_user: ["write_file", "apply_patch", "send_email"],
      forbidden: ["shell_exec"],
      external_ingestion: [],
    },
    isLoading: false,
    error: null,
  }),
}));

function renderChatView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatView conversationId="test-conv-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("ChatView", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Reset the controllable memories stub between tests so each starts
    // from a clean baseline.
    memoriesState.data.memories = [];
    memoriesState.data.recent = [];
    proposedCountState.data = 0;
    approvalsState.data = [];
    vi.mocked(getMessages).mockResolvedValue([]);
    chatStoreState.pendingPrompt = null;
  });

  it("renders input area and send button", () => {
    renderChatView();

    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "发送" });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("disables send button when input is empty", () => {
    renderChatView();

    const buttons = screen.getAllByRole("button", { name: "发送" });
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });

  it("shows approval dialog when stream requests confirmation", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-test-1",
          tool_call_id: "tc-test-1",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );

    renderChatView();

    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    const input = inputs[inputs.length - 1];
    fireEvent.change(input, { target: { value: "create a file" } });

    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/建议：写入文件/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/抱歉，未能生成回复/)).not.toBeInTheDocument();
  });

  it("calls resolveApproval when user confirms pending tool", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-test-1",
          tool_call_id: "tc-test-1",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    vi.mocked(resolveApproval).mockResolvedValue({
      status: "approved",
      result: '{"ok": true}',
      assistant_message: "File written.",
    });

    const { container } = renderChatView();

    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "create a file" },
    });
    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/建议：写入文件/)).toBeInTheDocument();
    });

    const confirmBtn = within(container).getByRole("button", { name: "确认写入" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(resolveApproval).toHaveBeenCalledWith(
        "ap-test-1",
        "approve",
        "write_file",
        { path: "/tmp/x", content: "data" },
        "test-conv-1",
        "tc-test-1",
      );
    });

    await waitFor(() => {
      expect(screen.getByText("File written.")).toBeInTheDocument();
    });
  });

  it("shows a denial note when the user cancels a pending tool", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-test-deny",
          tool_call_id: "tc-test-deny",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    vi.mocked(resolveApproval).mockResolvedValue({ status: "denied" });

    const { container } = renderChatView();

    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "create a file" },
    });
    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/建议：写入文件/)).toBeInTheDocument();
    });

    fireEvent.click(within(container).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(resolveApproval).toHaveBeenCalledWith(
        "ap-test-deny",
        "deny",
        "write_file",
        { path: "/tmp/x", content: "data" },
        "test-conv-1",
        "tc-test-deny",
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/已拒绝「write_file」/)).toBeInTheDocument();
    });
  });

  it("does not show 'I just remembered' toast on initial mount", () => {
    // Regression for Issue 5: initial cache load (or StrictMode remount)
    // must never fire a spurious toast. The notice only fires after the
    // user sends a message AND the memory total grows beyond the post-send
    // baseline — both gates are verified at the logic level. Driving the
    // full "growth after send" path here requires intercepting React's
    // re-render schedule in ways that make the test more brittle than the
    // code; the post-send growth branch is covered by manual smoke instead.
    memoriesState.data.memories = [{ content: "likes tea" }];
    memoriesState.data.recent = [{ content: "likes tea" }];
    renderChatView();
    expect(screen.queryByText(/我刚记住了/)).not.toBeInTheDocument();
  });

  it("sends a pending home prompt after messages hydrate", async () => {
    chatStoreState.pendingPrompt = "帮我规划今天";
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({ type: "text_delta", content: "好的，开始规划。" });
        onEvent({ type: "done" });
        onDone();
      },
    );

    renderChatView();

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        "test-conv-1",
        "帮我规划今天",
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
    expect(chatStoreState.pendingPrompt).toBeNull();
  });

  it("restores a pending confirmation from persisted tool_calls", async () => {
    vi.mocked(getMessages).mockResolvedValue([
      {
        id: "u1",
        conversation_id: "test-conv-1",
        role: "user",
        content: "请写入一个文件",
        tool_calls: null,
        tool_call_id: null,
        created_at: "2026-08-17T00:00:00Z",
      },
      {
        id: "a1",
        conversation_id: "test-conv-1",
        role: "assistant",
        content: "",
        tool_calls: JSON.stringify([
          {
            id: "tc-persist",
            function: { name: "write_file", arguments: JSON.stringify({ path: "/tmp/x" }) },
          },
        ]),
        tool_call_id: null,
        created_at: "2026-08-17T00:00:01Z",
      },
    ]);
    approvalsState.data = [
      {
        id: "ap-persist",
        action: "write_file",
        status: "pending",
        flow_type: "对话",
        flow_label: "测试对话",
        correlation_id: "c1",
        conversation_id: "test-conv-1",
        tool_call_id: "tc-persist",
        params: JSON.stringify({ path: "/tmp/x" }),
      },
    ];
    renderChatView();
    expect(await screen.findByText(/建议：写入文件/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认写入" })).toBeInTheDocument();
  });

  it("shows a review banner when proposed memories exist", () => {
    proposedCountState.data = 3;
    renderChatView();
    expect(screen.getByText(/3 条记忆待确认后才会进入对话/)).toBeInTheDocument();
  });

  it("ratifies a proposed memory from the chat banner", async () => {
    proposedCountState.data = 1;
    memoriesState.data.memories = [{ id: "m1", content: "喜欢早起跑步" }];
    memoriesState.data.recent = [{ id: "m1", content: "喜欢早起跑步" }];
    renderChatView();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(ratifyMemory).toHaveBeenCalledWith("m1"));
  });

  it("keeps the context toggle out of the proposed-memory banner", async () => {
    vi.mocked(getMessages).mockResolvedValue([
      {
        id: "u1",
        conversation_id: "test-conv-1",
        role: "user",
        content: "hello",
        tool_calls: null,
        tool_call_id: null,
        created_at: "2026-08-17T00:00:00Z",
      },
    ]);
    proposedCountState.data = 1;
    memoriesState.data.memories = [{ id: "m1", content: "喜欢早起跑步" }];
    renderChatView();

    const banner = await screen.findByText(/1 条记忆待确认后才会进入对话/);
    const contextBtn = await screen.findByRole("button", { name: "上下文" });
    expect(banner.closest(".border-b")?.contains(contextBtn)).toBe(false);
  });
});
