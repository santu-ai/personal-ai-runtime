import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter, MockApiError } from "../../test-utils";
import OnboardingWizard from "./OnboardingWizard";

const mockNavigate = vi.fn();
const setConversations = vi.fn();
const setActiveConversation = vi.fn();
const setPendingPrompt = vi.fn();
const { addError } = vi.hoisted(() => ({
  addError: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../api/client", () => ({
  getSystemHealth: vi.fn(),
  getLlmProviders: vi.fn(),
  createConversation: vi.fn(),
  ApiError: MockApiError,
}));

const chatStoreState = {
  conversations: [] as Array<{ id: string; title: string }>,
  setConversations,
  setActiveConversation,
  setPendingPrompt,
};

vi.mock("../../stores/chatStore", () => {
  const useChatStore = Object.assign(
    (selector: (s: typeof chatStoreState) => unknown) => selector(chatStoreState),
    { getState: () => chatStoreState },
  );
  return { useChatStore };
});

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addError }),
}));

import { getSystemHealth, getLlmProviders, createConversation } from "../../api/client";

const mockHealth = vi.mocked(getSystemHealth);
const mockLlm = vi.mocked(getLlmProviders);
const mockCreateConv = vi.mocked(createConversation);

function OnboardingHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开引导
      </button>
      {open ? <OnboardingWizard onComplete={() => setOpen(false)} /> : null}
    </>
  );
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows step 1 initially", () => {
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    expect(screen.getByText("连接后端")).toBeInTheDocument();
    expect(screen.getByText("首次引导 1/3")).toBeInTheDocument();
  });

  it("advances to step 2 after health check", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: false } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("运行检查"));
    await waitFor(() => expect(screen.getByText("后端运行正常")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => {
      expect(screen.getByText("配置 AI 大脑")).toBeInTheDocument();
    });
  });

  it("skips to step 3 when LLM already configured", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("运行检查"));
    await waitFor(() => expect(screen.getByText("后端运行正常")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => {
      expect(screen.getByText("开始第一次对话")).toBeInTheDocument();
    });
  });

  it("shows error when health check fails", async () => {
    mockHealth.mockRejectedValue(new MockApiError("无法连接", 503));
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => {
      expect(screen.getByText("无法连接")).toBeInTheDocument();
      expect(screen.getByText("连接后端")).toBeInTheDocument();
    });
  });

  it("shows settings button when LLM check fails", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: false } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockLlm.mockResolvedValue({ providers: [], default: "" });
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(screen.getByText("配置 AI 大脑")).toBeInTheDocument());
    fireEvent.click(screen.getByText("运行检查"));
    await waitFor(() => {
      expect(screen.getByText("前往设置页面配置")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("前往设置页面配置"));
    expect(localStorage.getItem("onboarding_done")).toBe("1");
    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("launches conversation from starter prompt", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockCreateConv.mockResolvedValue({
      id: "conv-new",
      title: "目标规划",
      summary: null,
      created_at: "2026-06-28T10:00:00Z",
      updated_at: "2026-06-28T10:00:00Z",
    });
    const onComplete = vi.fn();
    renderWithRouter(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByText("运行检查"));
    await waitFor(() => expect(screen.getByText("后端运行正常")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(screen.getByText("帮我规划一个目标")).toBeInTheDocument());
    fireEvent.click(screen.getByText("帮我规划一个目标"));
    await waitFor(() => {
      expect(mockCreateConv).toHaveBeenCalledWith("目标规划");
      expect(setPendingPrompt).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/chat/conv-new");
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("calls addError when createConversation fails", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockCreateConv.mockRejectedValue(new MockApiError("创建失败", 500));
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("运行检查"));
    await waitFor(() => expect(screen.getByText("后端运行正常")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    await waitFor(() => expect(screen.getByText("自由聊几句")).toBeInTheDocument());
    fireEvent.click(screen.getByText("自由聊几句"));
    await waitFor(() => {
      expect(addError).toHaveBeenCalledWith("创建失败", "对话");
    });
  });

  it("skip sets onboarding_done and calls onComplete", () => {
    const onComplete = vi.fn();
    renderWithRouter(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByText("跳过"));
    expect(localStorage.getItem("onboarding_done")).toBe("1");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  function defer<T>() {
    let release: (value: T) => void = () => {};
    const promise = new Promise<T>((resolve) => {
      release = resolve;
    });
    return { promise, release: (value: T) => release(value) };
  }

  it("does not check twice and keeps focus on 运行检查", async () => {
    const pending = defer<Awaited<ReturnType<typeof getSystemHealth>>>();
    mockHealth.mockImplementationOnce(() => pending.promise);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const check = screen.getByRole("button", { name: "运行检查" });
    const next = screen.getByRole("button", { name: "下一步" });
    check.focus();
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(next);
    await waitFor(() => expect(check).toHaveAttribute("aria-busy", "true"));
    expect(mockHealth).toHaveBeenCalledTimes(1);
    expect(check).toHaveTextContent("检查中…");
    expect(check).toBeEnabled();
    expect(check).toHaveFocus();
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("button", { name: "检查中…" })).toBe(check);

    await act(async () => {
      pending.release({
        status: "ok",
        auth_required: false,
        startup: { checks: { llm: { configured: false } } },
      } as Awaited<ReturnType<typeof getSystemHealth>>);
    });
    expect(await screen.findByText("后端运行正常")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行检查" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "运行检查" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("连接后端")).toBeInTheDocument();
  });

  it("keeps focus on 运行检查 when the health check fails", async () => {
    mockHealth.mockRejectedValue(new MockApiError("无法连接", 503));
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const check = screen.getByRole("button", { name: "运行检查" });
    check.focus();
    fireEvent.click(check);
    await waitFor(() => expect(screen.getByText("无法连接")).toBeInTheDocument());
    expect(check).toBeEnabled();
    expect(check).toHaveFocus();
    expect(check).not.toHaveAttribute("aria-busy");
  });

  it("does not advance twice and keeps focus on 下一步", async () => {
    const pending = defer<Awaited<ReturnType<typeof getSystemHealth>>>();
    mockHealth.mockImplementationOnce(() => pending.promise);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    const check = screen.getByRole("button", { name: "运行检查" });
    next.focus();
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(check);
    const busy = await screen.findByRole("button", { name: "检查中…" });
    expect(mockHealth).toHaveBeenCalledTimes(1);
    expect(busy).toBeEnabled();
    expect(busy).toHaveFocus();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(check).toBeEnabled();
    expect(check).not.toHaveAttribute("aria-busy");

    await act(async () => {
      pending.release({
        status: "ok",
        auth_required: false,
        startup: { checks: { llm: { configured: false } } },
      } as Awaited<ReturnType<typeof getSystemHealth>>);
    });
    expect(await screen.findByText("配置 AI 大脑")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toHaveFocus();
  });

  it("keeps focus on 下一步 when the health check fails", async () => {
    mockHealth.mockRejectedValue(new MockApiError("无法连接", 503));
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText("无法连接")).toBeInTheDocument());
    expect(screen.getByText("连接后端")).toBeInTheDocument();
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
    expect(next).not.toHaveAttribute("aria-busy");
  });

  it("restores 下一步 when focus fell away during a failed check", async () => {
    let fail: (err: unknown) => void = () => {};
    mockHealth.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    next.focus();
    fireEvent.click(next);
    await screen.findByRole("button", { name: "检查中…" });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      fail(new MockApiError("无法连接", 503));
    });
    expect(await screen.findByText("无法连接")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toHaveFocus();
    expect(screen.getByText("连接后端")).toBeInTheDocument();
  });

  it("does not steal focus after 下一步 returns", async () => {
    const pending = defer<Awaited<ReturnType<typeof getSystemHealth>>>();
    mockHealth.mockImplementationOnce(() => pending.promise);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    const skip = screen.getByRole("button", { name: "跳过" });
    next.focus();
    fireEvent.click(next);
    skip.focus();
    await act(async () => {
      pending.release({
        status: "ok",
        auth_required: false,
        startup: { checks: { llm: { configured: false } } },
      } as Awaited<ReturnType<typeof getSystemHealth>>);
    });
    expect(await screen.findByText("配置 AI 大脑")).toBeInTheDocument();
    expect(skip).toHaveFocus();
  });

  it("moves focus to the first starter when 下一步 finds LLM already configured", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    next.focus();
    fireEvent.click(next);
    const starter = await screen.findByRole("button", { name: /帮我规划一个目标/ });
    expect(screen.getByText("开始第一次对话")).toBeInTheDocument();
    expect(mockHealth).toHaveBeenCalledTimes(1);
    expect(mockLlm).not.toHaveBeenCalled();
    expect(starter).toHaveFocus();
  });

  it("does not steal focus when 下一步 skips to the starters", async () => {
    const pending = defer<Awaited<ReturnType<typeof getSystemHealth>>>();
    mockHealth.mockImplementationOnce(() => pending.promise);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    const next = screen.getByRole("button", { name: "下一步" });
    const skip = screen.getByRole("button", { name: "跳过" });
    next.focus();
    fireEvent.click(next);
    skip.focus();
    await act(async () => {
      pending.release({
        status: "ok",
        auth_required: false,
        startup: { checks: { llm: { configured: true } } },
      } as Awaited<ReturnType<typeof getSystemHealth>>);
    });
    expect(await screen.findByText("开始第一次对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "稍后再说" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /帮我规划一个目标/ })).not.toHaveFocus();
  });

  it("moves focus to the first starter after the LLM check succeeds", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: false } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockLlm.mockResolvedValue({ providers: [{ name: "deepseek" }], default: "deepseek" });
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("配置 AI 大脑")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "下一步" });
    next.focus();
    fireEvent.click(next);
    const starter = await screen.findByRole("button", { name: /帮我规划一个目标/ });
    expect(starter).toHaveFocus();
  });

  it("keeps focus on 下一步 when the LLM check fails", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: false } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockLlm.mockResolvedValue({ providers: [], default: "" });
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("配置 AI 大脑")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "下一步" });
    next.focus();
    fireEvent.click(next);
    expect(await screen.findByText("前往设置页面配置")).toBeInTheDocument();
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
    expect(next).not.toHaveAttribute("aria-busy");
  });

  async function openStarters() {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    renderWithRouter(<OnboardingWizard onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "运行检查" }));
    expect(await screen.findByText("后端运行正常")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("开始第一次对话")).toBeInTheDocument();
  }

  it("does not launch twice and keeps focus on the starter", async () => {
    const pending = defer<{
      id: string;
      title: string;
      summary: null;
      created_at: string;
      updated_at: string;
    }>();
    mockCreateConv.mockImplementationOnce(() => pending.promise);
    await openStarters();
    const first = screen.getByRole("button", { name: /帮我规划一个目标/ });
    const second = screen.getByRole("button", { name: /总结我的收件箱/ });
    first.focus();
    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(second);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    expect(mockCreateConv).toHaveBeenCalledTimes(1);
    expect(mockCreateConv).toHaveBeenCalledWith("目标规划");
    expect(first).toBeEnabled();
    expect(first).toHaveFocus();
    expect(second).toBeEnabled();
    expect(second).not.toHaveAttribute("aria-busy");
    expect(screen.getByText("正在开启对话…")).toBeInTheDocument();

    await act(async () => {
      pending.release({
        id: "conv-new",
        title: "目标规划",
        summary: null,
        created_at: "2026-06-28T10:00:00Z",
        updated_at: "2026-06-28T10:00:00Z",
      });
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/chat/conv-new"));
    expect(first).not.toHaveAttribute("aria-busy");
    expect(first).toHaveFocus();
  });

  it("keeps focus on the starter when creating a conversation fails", async () => {
    mockCreateConv.mockRejectedValue(new MockApiError("创建失败", 500));
    await openStarters();
    const first = screen.getByRole("button", { name: /自由聊几句/ });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("创建失败", "对话"));
    expect(screen.getByText("开始第一次对话")).toBeInTheDocument();
    expect(first).toBeEnabled();
    expect(first).toHaveFocus();
    expect(first).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("正在开启对话…")).not.toBeInTheDocument();
  });

  it("does not steal focus when a starter launch fails", async () => {
    let fail: (err: unknown) => void = () => {};
    mockCreateConv.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await openStarters();
    const first = screen.getByRole("button", { name: /帮我规划一个目标/ });
    const second = screen.getByRole("button", { name: /总结我的收件箱/ });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    second.focus();
    await act(async () => {
      fail(new MockApiError("创建失败", 500));
    });
    await waitFor(() => expect(first).not.toHaveAttribute("aria-busy"));
    expect(addError).toHaveBeenCalledWith("创建失败", "对话");
    expect(second).toHaveFocus();
  });

  it("keeps Tab inside the wizard and leaves on Escape", async () => {
    renderWithRouter(
      <>
        <button type="button">外面</button>
        <OnboardingWizard onComplete={vi.fn()} />
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "连接后端" });
    const outside = screen.getByRole("button", { name: "外面" });
    const check = screen.getByRole("button", { name: "运行检查" });
    const skip = screen.getByRole("button", { name: "跳过" });
    const next = screen.getByRole("button", { name: "下一步" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(check).toHaveFocus();
    fireEvent.keyDown(check, { key: "Tab" });
    expect(skip).toHaveFocus();
    fireEvent.keyDown(skip, { key: "Tab" });
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(check).toHaveFocus();
    expect(outside).not.toHaveFocus();

    fireEvent.keyDown(check, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(check).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();

    fireEvent.click(screen.getByTestId("onboarding-backdrop"));
    expect(localStorage.getItem("onboarding_done")).toBeNull();
    expect(dialog).toBeInTheDocument();
  });

  it("leaves on Escape and returns focus to the control that opened it", async () => {
    renderWithRouter(<OnboardingHost />);
    const opener = screen.getByRole("button", { name: "打开引导" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "连接后端" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(localStorage.getItem("onboarding_done")).toBe("1");
    expect(opener).toHaveFocus();

    fireEvent.keyDown(opener, { key: "Tab" });
    expect(opener).toHaveFocus();
  });

  it("does not leave on Escape while a check is in flight", async () => {
    const pending = defer<Awaited<ReturnType<typeof getSystemHealth>>>();
    mockHealth.mockImplementationOnce(() => pending.promise);
    const onComplete = vi.fn();
    renderWithRouter(<OnboardingWizard onComplete={onComplete} />);
    const check = screen.getByRole("button", { name: "运行检查" });
    check.focus();
    fireEvent.click(check);
    await waitFor(() => expect(check).toHaveAttribute("aria-busy", "true"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem("onboarding_done")).toBeNull();
    expect(screen.getByRole("dialog", { name: "连接后端" })).toBeInTheDocument();
    expect(check).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(localStorage.getItem("onboarding_done")).toBe("1");
  });

  it("keeps Tab on the starter buttons and does not leave on Escape while launching", async () => {
    const pending = defer<{
      id: string;
      title: string;
      summary: null;
      created_at: string;
      updated_at: string;
    }>();
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: true } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    const onComplete = vi.fn();
    renderWithRouter(
      <>
        <button type="button">外面</button>
        <OnboardingWizard onComplete={onComplete} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const first = await screen.findByRole("button", { name: /帮我规划一个目标/ });
    const last = screen.getByRole("button", { name: "稍后再说" });
    const outside = screen.getByRole("button", { name: "外面" });
    expect(screen.getByRole("dialog", { name: "开始第一次对话" })).toBeInTheDocument();
    first.focus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(first).toHaveFocus();

    mockCreateConv.mockImplementationOnce(() => pending.promise);
    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-busy", "true"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem("onboarding_done")).toBeNull();
    expect(screen.getByRole("dialog", { name: "开始第一次对话" })).toBeInTheDocument();
    expect(first).toHaveFocus();
  });

  it("includes the settings button in the Tab cycle", async () => {
    mockHealth.mockResolvedValue({
      status: "ok",
      auth_required: false,
      startup: { checks: { llm: { configured: false } } },
    } as Awaited<ReturnType<typeof getSystemHealth>>);
    mockLlm.mockResolvedValue({ providers: [], default: "" });
    renderWithRouter(
      <>
        <button type="button">外面</button>
        <OnboardingWizard onComplete={vi.fn()} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("配置 AI 大脑")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "运行检查" }));
    const settings = await screen.findByRole("button", { name: "前往设置页面配置" });
    const check = screen.getByRole("button", { name: "运行检查" });
    check.focus();
    fireEvent.keyDown(check, { key: "Tab" });
    expect(settings).toHaveFocus();
    screen.getByRole("button", { name: "外面" }).focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "下一步" })).toHaveFocus();
  });
});
