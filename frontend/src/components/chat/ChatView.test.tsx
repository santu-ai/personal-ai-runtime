import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatView from "./ChatView";
import {
  ApiError,
  cancelChat,
  getMessages,
  resolveApproval,
  sendMessage,
  ratifyMemory,
  type Message,
} from "../../api/client";

vi.mock("../../api/client", () => ({
  getMessages: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn(),
  cancelChat: vi.fn().mockResolvedValue({ status: "ok", cancelled: 0 }),
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

function markTranscriptScrolledUp() {
  const el = screen.getByTestId("chat-transcript");
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(el, "scrollTop", { configurable: true, value: 0 });
  fireEvent.scroll(el);
}

async function flushTranscriptScroll() {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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

  it("keeps the confirmation when approval resume fails", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-resume-fail",
          tool_call_id: "tc-resume-fail",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    vi.mocked(resolveApproval).mockResolvedValue({
      status: "resume_failed",
      retryable: true,
      error: "LLM API error",
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
    fireEvent.click(within(container).getByRole("button", { name: "确认写入" }));

    await waitFor(() => {
      expect(resolveApproval).toHaveBeenCalled();
    });
    expect(within(container).getByRole("button", { name: "确认写入" })).toBeInTheDocument();
    expect(screen.queryByText("File written.")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("focuses the confirm button and does not return focus to the composer", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-focus",
          tool_call_id: "tc-focus",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "create a file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const confirmBtn = await screen.findByRole("button", { name: "确认写入" });
    const composer = screen.getByPlaceholderText(/输入消息/);
    expect(confirmBtn).toHaveFocus();
    expect(composer).not.toHaveFocus();
    expect(composer).toBeDisabled();
  });

  it("scrolls the transcript when a confirmation appears while following the latest turn", async () => {
    let emit: ((event: Record<string, unknown>) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      (_convId, _content, onEvent) =>
        new Promise(() => {
          emit = (event) => onEvent(event as never);
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "create a file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByTestId("chat-transcript")).toBeInTheDocument();
    await flushTranscriptScroll();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => {
      emit?.({
        type: "confirmation_required",
        tool_name: "write_file",
        tool_args: { path: "/tmp/x", content: "data" },
        approval_id: "ap-scroll",
        tool_call_id: "tc-scroll",
      });
    });

    expect(await screen.findByRole("button", { name: "确认写入" })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "↓ 待确认" })).not.toBeInTheDocument();
  });

  it("offers a jump to the pending confirmation instead of pulling a scrolled transcript", async () => {
    let emit: ((event: Record<string, unknown>) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      (_convId, _content, onEvent) =>
        new Promise(() => {
          emit = (event) => onEvent(event as never);
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "create a file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByTestId("chat-transcript")).toBeInTheDocument();
    await flushTranscriptScroll();
    markTranscriptScrolledUp();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => {
      emit?.({
        type: "confirmation_required",
        tool_name: "write_file",
        tool_args: { path: "/tmp/x", content: "data" },
        approval_id: "ap-jump",
        tool_call_id: "tc-jump",
      });
    });

    const jump = await screen.findByRole("button", { name: "↓ 待确认" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(jump);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "↓ 待确认" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认写入" })).toBeInTheDocument();
  });

  it("keeps the ask_user answer when resume fails", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "ask_user",
          tool_args: { question: "简报要覆盖最近几天？" },
          approval_id: "ap-ask",
          tool_call_id: "tc-ask",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    let release:
      ((value: { status: string; retryable?: boolean; error?: string }) => void) | undefined;
    vi.mocked(resolveApproval).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "做一份简报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const answer = await screen.findByLabelText("你的回答");
    expect(answer).toHaveFocus();
    fireEvent.change(answer, { target: { value: "最近三天" } });
    const sendAnswer = screen.getByRole("button", { name: "发送回答" });
    fireEvent.click(sendAnswer);
    fireEvent.click(sendAnswer);

    await waitFor(() => expect(resolveApproval).toHaveBeenCalledTimes(1));
    expect(answer).toHaveValue("最近三天");
    expect(sendAnswer).toBeDisabled();

    release?.({ status: "resume_failed", retryable: true, error: "LLM API error" });

    await waitFor(() => expect(sendAnswer).toBeEnabled());
    expect(answer).toHaveValue("最近三天");
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("clears the confirmation when switching conversations", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-test-switch",
          tool_call_id: "tc-test-switch",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function renderWith(id: string) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ChatView conversationId={id} />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }

    const { rerender } = render(renderWith("test-conv-1"));
    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "create a file" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "发送" })[
        screen.getAllByRole("button", { name: "发送" }).length - 1
      ],
    );
    expect(await screen.findByText(/建议：写入文件/)).toBeInTheDocument();

    rerender(renderWith("test-conv-2"));
    await waitFor(() => {
      expect(screen.queryByText(/建议：写入文件/)).not.toBeInTheDocument();
    });
  });

  it("shows the next confirmation when approve resumes into another tool", async () => {
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
      assistant_message: "接下来写入第二份文件。",
      pending: true,
      tool_name: "write_file",
      tool_args: { path: "/tmp/y", content: "next" },
      approval_id: "ap-test-2",
      tool_call_id: "tc-test-2",
    });

    const { container } = renderChatView();
    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "create two files" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "发送" })[
        screen.getAllByRole("button", { name: "发送" }).length - 1
      ],
    );

    await waitFor(() => {
      expect(screen.getByText(/建议：写入文件/)).toBeInTheDocument();
    });
    fireEvent.click(within(container).getByRole("button", { name: "确认写入" }));

    await waitFor(() => {
      expect(screen.getByText("接下来写入第二份文件。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "确认写入" })).toBeInTheDocument();
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
    expect(screen.queryByText(/待确认：/)).not.toBeInTheDocument();
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
    await waitFor(() => {
      expect(chatStoreState.pendingPrompt).toBeNull();
    });
  });

  it("does not show the empty conversation when history fails to load", async () => {
    vi.mocked(getMessages).mockRejectedValueOnce(new Error("   "));
    renderChatView();

    const error = await screen.findByTestId("chat-messages-load-error");
    expect(error).toHaveTextContent("加载消息失败");
    expect(screen.queryByRole("heading", { name: "开始对话" })).not.toBeInTheDocument();

    vi.mocked(getMessages).mockResolvedValueOnce([]);
    fireEvent.click(within(error).getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("heading", { name: "开始对话" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-messages-load-error")).not.toBeInTheDocument();
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it("keeps the retry and holds a home prompt until history loads", async () => {
    chatStoreState.pendingPrompt = "帮我规划今天";
    let release: ((rows: Message[]) => void) | undefined;
    vi.mocked(getMessages)
      .mockRejectedValueOnce(new ApiError("对话暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise<Message[]>((resolve) => {
            release = resolve;
          }),
      );
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({ type: "text_delta", content: "好的，开始规划。" });
        onEvent({ type: "done" });
        onDone();
      },
    );

    renderChatView();
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(screen.getByTestId("chat-messages-load-error")).toHaveTextContent("对话暂时读不到");
    expect(screen.queryByRole("heading", { name: "开始对话" })).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(retry).toHaveFocus());

    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("chat-messages-load-error")).toHaveTextContent("对话暂时读不到");
    expect(screen.queryByRole("heading", { name: "开始对话" })).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();

    release?.([]);
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
    expect(screen.queryByTestId("chat-messages-load-error")).not.toBeInTheDocument();
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
    const confirmBtn = screen.getByRole("button", { name: "确认写入" });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn).toHaveFocus();
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("shows a review banner when proposed memories exist", () => {
    proposedCountState.data = 3;
    renderChatView();
    expect(screen.getByText(/3 条本对话记忆待确认后才会进入对话/)).toBeInTheDocument();
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

    const banner = await screen.findByText(/1 条本对话记忆待确认后才会进入对话/);
    const contextBtn = await screen.findByRole("button", { name: "上下文" });
    expect(banner.closest(".border-b")?.contains(contextBtn)).toBe(false);
  });

  it("shows a clickable cancel button while generating", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, _onEvent, _onError, onDone, signal) => {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        onDone();
      },
    );
    vi.mocked(cancelChat).mockResolvedValue({ status: "ok", cancelled: 1 });

    renderChatView();
    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "写一篇长文" } });
    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    const cancelBtn = await screen.findByRole("button", { name: "取消生成" });
    expect(cancelBtn).toBeEnabled();
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(cancelChat).toHaveBeenCalledWith("test-conv-1");
    });
    expect(await screen.findByText("已取消生成。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
  });
});
