import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatView, { chatViewLayoutFocus } from "./ChatView";
import { clearComposerDrafts, writeComposerDraft } from "./composerDraft";
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

function markTranscriptAtBottom() {
  const el = screen.getByTestId("chat-transcript");
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 400 });
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

/** 续写失败、卡片还在的那一轮，绘制前焦点已经离开页面空白。useEffect 会先停在 body。 */
function captureFocusWhenSettled(settled: () => boolean): { read: () => Element | null } {
  let focusAtLayout: Element | null = null;
  chatViewLayoutFocus.notify = () => {
    if (!settled()) return;
    focusAtLayout ??= document.activeElement;
  };
  return {
    read: () => focusAtLayout,
  };
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

/** 同一棵树再渲染，才能在发出之后把待确认记忆数加上去。 */
function mountChatView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatView conversationId="test-conv-1" />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    rerenderChat() {
      view.rerender(tree());
    },
  };
}

function growProposedMemory(content: string) {
  memoriesState.data = {
    memories: [{ id: "m-new", content }],
    recent: [{ id: "m-new", content }],
  };
}
describe("ChatView", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    chatViewLayoutFocus.notify = null;
    vi.clearAllMocks();
    // Reset the controllable memories stub between tests so each starts
    // from a clean baseline.
    memoriesState.data.memories = [];
    memoriesState.data.recent = [];
    proposedCountState.data = 0;
    approvalsState.data = [];
    vi.mocked(getMessages).mockResolvedValue([]);
    chatStoreState.pendingPrompt = null;
    clearComposerDrafts();
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

  it("keeps Tab inside the confirmation card and leaves it on Escape without resolving", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-tab",
          tool_call_id: "tc-tab",
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

    const confirm = await screen.findByRole("button", { name: "确认写入" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const writeSummary = screen.getByText("查看写入内容");
    const argsSummary = screen.getByText("查看详细参数");
    const context = screen.getByRole("button", { name: "上下文" });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(writeSummary).toHaveFocus();
    fireEvent.keyDown(writeSummary, { key: "Tab" });
    expect(argsSummary).toHaveFocus();
    fireEvent.keyDown(argsSummary, { key: "Tab" });
    expect(confirm).toHaveFocus();
    expect(context).not.toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Tab", shiftKey: true });
    expect(argsSummary).toHaveFocus();

    context.focus();
    fireEvent.keyDown(context, { key: "Tab" });
    expect(context).toHaveFocus();
    expect(confirm).not.toHaveFocus();

    confirm.focus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(writeSummary).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(context).toHaveFocus();
    expect(resolveApproval).not.toHaveBeenCalled();
    expect(confirm).toBeInTheDocument();

    fireEvent.click(context);
    const collapse = await screen.findByRole("button", { name: "收起" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(collapse).toHaveFocus();
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it("skips a disabled ask_user send button while cycling Tab", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "ask_user",
          tool_args: { question: "简报要覆盖最近几天？" },
          approval_id: "ap-ask-tab",
          tool_call_id: "tc-ask-tab",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "做一份简报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const answer = await screen.findByLabelText("你的回答");
    const sendAnswer = screen.getByRole("button", { name: "发送回答" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const argsSummary = screen.getByText("查看详细参数");
    expect(answer).toHaveFocus();
    expect(sendAnswer).toBeDisabled();

    fireEvent.keyDown(answer, { key: "Escape", isComposing: true });
    fireEvent.keyDown(answer, { key: "Escape", keyCode: 229 });
    expect(answer).toHaveFocus();

    fireEvent.keyDown(answer, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(argsSummary).toHaveFocus();
    fireEvent.keyDown(argsSummary, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.change(answer, { target: { value: "最近三天" } });
    answer.focus();
    fireEvent.keyDown(answer, { key: "Tab" });
    expect(sendAnswer).toHaveFocus();
    expect(sendAnswer).toBeEnabled();
    fireEvent.keyDown(sendAnswer, { key: "Tab" });
    expect(cancel).toHaveFocus();
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
    const seen = captureFocusWhenSettled(
      () => screen.queryByRole("button", { name: "↓ 待确认" }) == null,
    );
    jump.focus();
    fireEvent.click(jump);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "↓ 待确认" })).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "确认写入" });
    expect(confirm).toHaveFocus();
    expect(seen.read()).toBe(confirm);
  });

  it("returns focus to the composer when the new-message jump unmounts", async () => {
    let emit: ((event: Record<string, unknown>) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      (_convId, _content, onEvent) =>
        new Promise(() => {
          emit = (event) => onEvent(event as never);
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "继续写" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByTestId("chat-transcript")).toBeInTheDocument();
    await flushTranscriptScroll();
    markTranscriptScrolledUp();

    act(() => {
      emit?.({ type: "text_delta", content: "还在写" });
    });

    const jump = await screen.findByRole("button", { name: "↓ 新消息" });
    const seen = captureFocusWhenSettled(
      () => screen.queryByRole("button", { name: "↓ 新消息" }) == null,
    );
    jump.focus();
    fireEvent.click(jump);
    const composer = screen.getByPlaceholderText(/输入消息/);
    expect(composer).toHaveFocus();
    expect(seen.read()).toBe(composer);
    expect(screen.queryByRole("button", { name: "↓ 新消息" })).not.toBeInTheDocument();
  });

  it("does not steal focus when the jump chip hides without being focused", async () => {
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

    act(() => {
      emit?.({
        type: "confirmation_required",
        tool_name: "write_file",
        tool_args: { path: "/tmp/x", content: "data" },
        approval_id: "ap-jump-keep",
        tool_call_id: "tc-jump-keep",
      });
    });

    expect(await screen.findByRole("button", { name: "↓ 待确认" })).toBeInTheDocument();
    const context = screen.getByRole("button", { name: "上下文" });
    const jump = screen.getByRole("button", { name: "↓ 待确认" });
    jump.focus();
    context.focus();
    markTranscriptAtBottom();
    expect(screen.queryByRole("button", { name: "↓ 待确认" })).not.toBeInTheDocument();
    expect(context).toHaveFocus();
    expect(screen.getByRole("button", { name: "确认写入" })).not.toHaveFocus();
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
    const cancel = screen.getByRole("button", { name: "取消" });
    sendAnswer.focus();
    fireEvent.click(sendAnswer);
    fireEvent.click(sendAnswer);
    fireEvent.click(cancel);

    await waitFor(() => expect(resolveApproval).toHaveBeenCalledTimes(1));
    expect(answer).toHaveValue("最近三天");
    expect(answer).toBeEnabled();
    expect(sendAnswer).toBeEnabled();
    expect(sendAnswer).toHaveAttribute("aria-busy", "true");
    expect(sendAnswer).toHaveFocus();
    expect(cancel).not.toHaveAttribute("aria-busy");

    release?.({ status: "resume_failed", retryable: true, error: "LLM API error" });

    await waitFor(() => expect(sendAnswer).not.toHaveAttribute("aria-busy"));
    expect(sendAnswer).toHaveFocus();
    expect(answer).toHaveValue("最近三天");
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("does not confirm twice and keeps focus on the busy button", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-busy",
          tool_call_id: "tc-busy",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    let release:
      ((value: { status: string; error?: string; retryable?: boolean }) => void) | undefined;
    vi.mocked(resolveApproval).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "create a file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const confirm = await screen.findByRole("button", { name: "确认写入" });
    const cancel = screen.getByRole("button", { name: "取消" });
    confirm.focus();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(cancel);

    await waitFor(() => expect(confirm).toHaveAttribute("aria-busy", "true"));
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
    expect(cancel).not.toHaveAttribute("aria-busy");
    expect(resolveApproval).toHaveBeenCalledTimes(1);
    expect(resolveApproval).toHaveBeenCalledWith(
      "ap-busy",
      "approve",
      "write_file",
      { path: "/tmp/x", content: "data" },
      "test-conv-1",
      "tc-busy",
    );

    const elsewhere = screen.getByRole("button", { name: "上下文" });
    elsewhere.focus();
    const focusWhenFailed = captureFocusWhenSettled(() => {
      const button = screen.queryByRole("button", { name: "确认写入" });
      return button instanceof HTMLButtonElement && !button.hasAttribute("aria-busy");
    });
    await act(async () => {
      release?.({ status: "resume_failed", retryable: true, error: "LLM API error" });
    });
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(elsewhere).toHaveFocus();
    expect(focusWhenFailed.read()).toBe(elsewhere);
    expect(screen.getByRole("button", { name: "确认写入" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("returns focus to cancel when deny fails and focus was dropped", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-deny",
          tool_call_id: "tc-deny",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    let release: ((error: Error) => void) | undefined;
    vi.mocked(resolveApproval).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          release = reject;
        }),
    );

    renderChatView();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "create a file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const cancel = await screen.findByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认写入" });
    cancel.focus();
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    fireEvent.click(confirm);

    await waitFor(() => expect(cancel).toHaveAttribute("aria-busy", "true"));
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveFocus();
    expect(confirm).not.toHaveAttribute("aria-busy");
    expect(resolveApproval).toHaveBeenCalledTimes(1);

    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    const focusWhenFailed = captureFocusWhenSettled(() => {
      const button = screen.queryByRole("button", { name: "取消" });
      return button instanceof HTMLButtonElement && !button.hasAttribute("aria-busy");
    });
    await act(async () => {
      release?.(new ApiError("拒绝失败", 500));
    });
    expect(cancel).not.toHaveAttribute("aria-busy");
    expect(cancel).toHaveFocus();
    expect(focusWhenFailed.read()).toBe(cancel);
    expect(focusWhenFailed.read()).not.toBe(document.body);
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
  });

  it("restores the answer field before paint when a failed send disables the button", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "ask_user",
          tool_args: { question: "简报要覆盖最近几天？" },
          approval_id: "ap-ask-fail",
          tool_call_id: "tc-ask-fail",
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
    fireEvent.change(answer, { target: { value: "最近三天" } });
    const sendAnswer = screen.getByRole("button", { name: "发送回答" });
    sendAnswer.focus();
    fireEvent.click(sendAnswer);
    await waitFor(() => expect(sendAnswer).toHaveAttribute("aria-busy", "true"));
    expect(sendAnswer).toHaveFocus();

    fireEvent.change(answer, { target: { value: "" } });
    expect(sendAnswer).toBeEnabled();
    expect(sendAnswer).toHaveFocus();

    const focusWhenFailed = captureFocusWhenSettled(() => {
      const button = screen.queryByRole("button", { name: "发送回答" });
      return button instanceof HTMLButtonElement && !button.hasAttribute("aria-busy");
    });
    await act(async () => {
      release?.({ status: "resume_failed", retryable: true, error: "LLM API error" });
    });

    expect(sendAnswer).toBeDisabled();
    expect(answer).toHaveFocus();
    expect(focusWhenFailed.read()).toBe(answer);
    expect(focusWhenFailed.read()).not.toBe(document.body);
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
    // baseline. The growth path is covered by the notice dismiss focus tests.
    memoriesState.data.memories = [{ content: "likes tea" }];
    memoriesState.data.recent = [{ content: "likes tea" }];
    renderChatView();
    expect(screen.queryByText(/我刚记住了/)).not.toBeInTheDocument();
    expect(screen.queryByText(/待确认：/)).not.toBeInTheDocument();
  });

  function mockPlainReply(text: string) {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({ type: "text_delta", content: text });
        onEvent({ type: "done" });
        onDone();
      },
    );
  }

  async function sendFromComposer() {
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "请记住我喜欢喝茶" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
  }

  it("moves focus to the composer in the same layout turn when 待确认 is closed", async () => {
    mockPlainReply("记下了。");
    const view = mountChatView();
    await sendFromComposer();
    await waitFor(() => expect(screen.getByText("记下了。")).toBeInTheDocument());

    growProposedMemory("喜欢喝茶");
    view.rerenderChat();
    const close = screen.getByRole("button", { name: "关闭" });
    expect(screen.getByText("待确认：喜欢喝茶")).toBeInTheDocument();
    const field = screen.getByPlaceholderText(/输入消息/);
    const seen = captureFocusWhenSettled(
      () => screen.queryByRole("button", { name: "关闭" }) == null,
    );
    close.focus();
    fireEvent.click(close);

    expect(screen.queryByText("待确认：喜欢喝茶")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(seen.read()).toBe(field);
  });

  it("moves focus to the composer when 待确认 times out while the close button is focused", async () => {
    mockPlainReply("记下了。");
    const view = mountChatView();
    await sendFromComposer();
    await waitFor(() => expect(screen.getByText("记下了。")).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      growProposedMemory("喜欢喝茶");
      view.rerenderChat();
      const close = screen.getByRole("button", { name: "关闭" });
      const field = screen.getByPlaceholderText(/输入消息/);
      const seen = captureFocusWhenSettled(
        () => screen.queryByRole("button", { name: "关闭" }) == null,
      );
      close.focus();
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.queryByText("待确认：喜欢喝茶")).not.toBeInTheDocument();
      expect(field).toHaveFocus();
      expect(document.body).not.toHaveFocus();
      expect(seen.read()).toBe(field);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not steal focus when 待确认 times out after focus already moved", async () => {
    mockPlainReply("记下了。");
    const view = mountChatView();
    await sendFromComposer();
    await waitFor(() => expect(screen.getByText("记下了。")).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      growProposedMemory("喜欢喝茶");
      view.rerenderChat();
      const context = screen.getByRole("button", { name: "上下文" });
      context.focus();
      const seen = captureFocusWhenSettled(
        () => screen.queryByRole("button", { name: "关闭" }) == null,
      );
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.queryByText("待确认：喜欢喝茶")).not.toBeInTheDocument();
      expect(context).toHaveFocus();
      expect(seen.read()).toBe(context);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves focus to the confirm button when 待确认 closes during a pending confirmation", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-memory-notice",
          tool_call_id: "tc-memory-notice",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    const view = mountChatView();
    await sendFromComposer();
    const confirm = await screen.findByRole("button", { name: "确认写入" });
    await waitFor(() => expect(confirm).toHaveFocus());

    growProposedMemory("喜欢喝茶");
    view.rerenderChat();
    const close = screen.getByRole("button", { name: "关闭" });
    const seen = captureFocusWhenSettled(
      () => screen.queryByRole("button", { name: "关闭" }) == null,
    );
    close.focus();
    fireEvent.click(close);

    expect(screen.getByRole("button", { name: "确认写入" })).toHaveFocus();
    expect(screen.getByPlaceholderText(/输入消息/)).not.toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(seen.read()).toBe(screen.getByRole("button", { name: "确认写入" }));
  });

  it("moves focus to the answer field when 待确认 closes during ask_user", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "ask_user",
          tool_args: { question: "简报要覆盖最近几天？" },
          approval_id: "ap-memory-ask",
          tool_call_id: "tc-memory-ask",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    const view = mountChatView();
    await sendFromComposer();
    const answer = await screen.findByLabelText("你的回答");
    await waitFor(() => expect(answer).toHaveFocus());

    growProposedMemory("喜欢喝茶");
    view.rerenderChat();
    const close = screen.getByRole("button", { name: "关闭" });
    const seen = captureFocusWhenSettled(
      () => screen.queryByRole("button", { name: "关闭" }) == null,
    );
    close.focus();
    fireEvent.click(close);

    expect(answer).toHaveFocus();
    expect(screen.getByRole("button", { name: "发送回答" })).not.toHaveFocus();
    expect(document.body).not.toHaveFocus();
    expect(seen.read()).toBe(answer);
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

  it("moves focus from 上下文 to 收起 and back without landing on the page", async () => {
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
    renderChatView();

    const open = await screen.findByRole("button", { name: "上下文" });
    const field = screen.getByPlaceholderText(/输入消息/);
    // 消息读回来时输入框会先拿到焦点。等这一轮结束再点，避免和打开面板挤在同一帧。
    await waitFor(() => expect(field).toHaveFocus());
    open.focus();
    fireEvent.click(open);
    const collapse = await screen.findByRole("button", { name: "收起" });
    expect(collapse).toHaveFocus();
    expect(document.body).not.toHaveFocus();

    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "上下文" })).toHaveFocus();

    const openAgain = screen.getByRole("button", { name: "上下文" });
    openAgain.focus();
    fireEvent.click(openAgain);
    field.focus();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "上下文" })).not.toHaveFocus();
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

  it("keeps composer focus while generating and does not send again", async () => {
    let release: (() => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, _onEvent, _onError, onDone) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onDone();
      },
    );

    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/);
    field.focus();
    fireEvent.change(field, { target: { value: "写一篇长文" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const cancel = await screen.findByRole("button", { name: "取消生成" });
    const composer = screen.getByPlaceholderText(/输入消息/);
    expect(composer).toBeEnabled();
    expect(composer).toHaveAttribute("aria-busy", "true");
    expect(composer).toHaveFocus();
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveAttribute("aria-busy", "true");
    expect(sendMessage).toHaveBeenCalledTimes(1);

    fireEvent.change(composer, { target: { value: "下一句先留着" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveValue("下一句先留着");
    expect(composer).toHaveFocus();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const elsewhere = screen.getByRole("button", { name: "上下文" });
    elsewhere.focus();
    release?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    expect(elsewhere).toHaveFocus();
    expect(composer).toHaveValue("下一句先留着");
    expect(composer).not.toHaveAttribute("aria-busy");
  });

  it("keeps focus on cancel while generating, then returns to the composer", async () => {
    let release: (() => void) | undefined;
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
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, _onEvent, _onError, onDone) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        onDone();
      },
    );

    renderChatView();
    expect(await screen.findByText("hello")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "写一篇长文" },
    });
    const send = screen.getByRole("button", { name: "发送" });
    send.focus();
    fireEvent.click(send);

    const cancel = await screen.findByRole("button", { name: "取消生成" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveFocus();
    expect(screen.getByPlaceholderText(/输入消息/)).toBeEnabled();

    release?.();
    await waitFor(() => expect(screen.getByPlaceholderText(/输入消息/)).toHaveFocus());
  });

  it("returns focus to the composer when generation fails and focus was dropped", async () => {
    let fail: ((message: string) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      (_convId, _content, _onEvent, onError) =>
        new Promise((resolve) => {
          fail = (message: string) => {
            onError(message);
            resolve(undefined);
          };
        }),
    );

    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/);
    field.focus();
    fireEvent.change(field, { target: { value: "写一篇长文" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const composer = screen.getByPlaceholderText(/输入消息/);
    expect(await screen.findByRole("button", { name: "取消生成" })).toBeInTheDocument();
    expect(composer).toHaveFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fail?.("生成失败");
    await waitFor(() => expect(composer).toHaveFocus());
    expect(composer).toBeEnabled();
    expect(composer).not.toHaveAttribute("aria-busy");
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

  function composer() {
    const inputs = screen.getAllByPlaceholderText(/输入消息/);
    return inputs[inputs.length - 1];
  }

  it("restores an unsent draft after leaving and does not carry it to another conversation", () => {
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

    const first = render(renderWith("test-conv-1"));
    fireEvent.change(composer(), { target: { value: "只在第一条" } });
    first.unmount();

    const second = render(renderWith("test-conv-1"));
    expect(composer()).toHaveValue("只在第一条");

    second.rerender(renderWith("test-conv-2"));
    expect(composer()).toHaveValue("");
    fireEvent.change(composer(), { target: { value: "第二条自己的" } });

    second.rerender(renderWith("test-conv-1"));
    expect(composer()).toHaveValue("只在第一条");
    second.rerender(renderWith("test-conv-2"));
    expect(composer()).toHaveValue("第二条自己的");
  });

  it("drops the draft after the line is submitted", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({ type: "text_delta", content: "好" });
        onEvent({ type: "done" });
        onDone();
      },
    );
    const { unmount } = renderChatView();
    fireEvent.change(composer(), { target: { value: "发出去" } });
    fireEvent.click(
      screen.getAllByRole("button", { name: "发送" })[
        screen.getAllByRole("button", { name: "发送" }).length - 1
      ],
    );
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(composer()).toHaveValue("");
    unmount();
    renderChatView();
    expect(composer()).toHaveValue("");
  });

  it("keeps a draft typed while a confirmation is open", async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_convId, _content, onEvent, _onError, onDone) => {
        onEvent({
          type: "confirmation_required",
          tool_name: "write_file",
          tool_args: { path: "/tmp/x", content: "data" },
          approval_id: "ap-draft",
          tool_call_id: "tc-draft",
        });
        onEvent({ type: "done" });
        onDone();
      },
    );
    renderChatView();
    fireEvent.change(composer(), { target: { value: "先发出" } });
    fireEvent.click(
      screen.getAllByRole("button", { name: "发送" })[
        screen.getAllByRole("button", { name: "发送" }).length - 1
      ],
    );
    expect(await screen.findByText(/建议：写入文件/)).toBeInTheDocument();

    fireEvent.change(composer(), { target: { value: "确认期间先留着" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(composer()).toHaveValue("确认期间先留着");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a pending home prompt without erasing the unsent draft", async () => {
    writeComposerDraft("test-conv-1", "先写着");
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
    expect(composer()).toHaveValue("先写着");
  });

  it("fills an empty composer from a prompt chip before paint", () => {
    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    const chip = screen.getByRole("button", { name: "读写文件" });
    const prompt = "帮我在桌面创建一个 todo.md，列出今天的任务";
    const seen = captureFocusWhenSettled(
      () => document.activeElement === field && field.value === prompt,
    );
    chip.focus();
    fireEvent.click(chip);
    expect(field).toHaveValue(prompt);
    expect(field.selectionStart).toBe(prompt.length);
    expect(seen.read()).toBe(field);
    expect(field).toHaveFocus();
  });

  it("replaces a whitespace-only composer when a prompt chip is chosen", () => {
    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "读写文件" }));
    expect(field).toHaveValue("帮我在桌面创建一个 todo.md，列出今天的任务");
  });

  it("keeps an unsent draft when a prompt chip is chosen and does not steal focus later", async () => {
    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "先写着" } });
    const chip = screen.getByRole("button", { name: "读写文件" });
    const seen = captureFocusWhenSettled(
      () => document.activeElement === field && field.value === "先写着",
    );
    chip.focus();
    fireEvent.click(chip);
    expect(field).toHaveValue("先写着");
    expect(field.selectionStart).toBe("先写着".length);
    expect(seen.read()).toBe(field);
    expect(field).toHaveFocus();

    const other = screen.getByRole("button", { name: "搜索网页" });
    other.focus();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(other).toHaveFocus();
    expect(field).toHaveValue("先写着");
  });

  it("does not pull focus off another control when a prompt chip click does not take focus", () => {
    renderChatView();
    const field = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(field, { target: { value: "先写着" } });
    const other = screen.getByRole("button", { name: "搜索网页" });
    other.focus();
    fireEvent.click(screen.getByRole("button", { name: "读写文件" }));
    expect(field).toHaveValue("先写着");
    expect(other).toHaveFocus();
  });

  it("keeps an in-thread draft when a suggestion chip is chosen", async () => {
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
    renderChatView();
    const chip = await screen.findByRole("button", { name: "查看今日收件箱摘要" });
    const field = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "先写着" } });
    chip.focus();
    fireEvent.click(chip);
    expect(field).toHaveValue("先写着");
    expect(field).toHaveFocus();
  });
});
