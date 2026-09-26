import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithRouter, MockApiError } from "../../test-utils";
import QuickCaptureDialog, { quickCaptureLayoutFocus } from "./QuickCaptureDialog";

const { addError } = vi.hoisted(() => ({
  addError: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  createMemory: vi.fn(),
  ApiError: MockApiError,
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addError }),
}));

import { createMemory } from "../../api/client";

const mockCreateMemory = vi.mocked(createMemory);

function openDialog() {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "quick-capture" },
        origin: window.location.origin,
      }),
    );
  });
}

describe("QuickCaptureDialog", () => {
  /** 留下草稿的那一轮，绘制前焦点已经在输入框上。useEffect 会先停在页面空白。 */
  function captureFocusWhenSettled(settled: () => boolean): { read: () => Element | null } {
    let focusAtLayout: Element | null = null;
    quickCaptureLayoutFocus.notify = () => {
      if (!settled()) return;
      focusAtLayout ??= document.activeElement;
    };
    return {
      read: () => focusAtLayout,
    };
  }

  beforeEach(() => {
    quickCaptureLayoutFocus.notify = null;
    vi.clearAllMocks();
  });

  it("renders nothing by default", () => {
    const { container } = renderWithRouter(<QuickCaptureDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on quick-capture postMessage", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    await waitFor(() => {
      expect(screen.getByText("快速捕获")).toBeInTheDocument();
    });
  });

  it("ignores quick-capture postMessage from another origin", () => {
    renderWithRouter(<QuickCaptureDialog />);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "quick-capture" },
          origin: "https://evil.example",
        }),
      );
    });
    expect(screen.queryByText("快速捕获")).not.toBeInTheDocument();
  });

  it("returns focus to the opener after Escape", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "快捷捕获";
    document.body.appendChild(opener);
    opener.focus();
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const field = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    expect(field).toHaveClass("focus-visible:ring-focus-ring");
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("快速捕获")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("opens on Ctrl+Shift+M", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByText("快速捕获")).toBeInTheDocument();
    });
  });

  it("does not open while an IME composition is in progress", () => {
    renderWithRouter(<QuickCaptureDialog />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: "M", metaKey: true, shiftKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true, keyCode: 229 });
    expect(screen.queryByText("快速捕获")).not.toBeInTheDocument();
  });

  it("keeps the draft when the shortcut or desktop capture fires again", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "还没保存" } });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "M", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true, repeat: true });
    openDialog();
    expect(textarea).toHaveValue("还没保存");
    expect(screen.getByText("快速捕获")).toBeInTheDocument();
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it("does not drop an in-flight save when capture is requested again", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "只记一次" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "保存中..." });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true });
    openDialog();
    expect(textarea).toHaveValue("只记一次");
    expect(mockCreateMemory).toHaveBeenCalledTimes(1);
    release({ id: "mem-1", status: "ok" });
    expect(await screen.findByRole("button", { name: "已保存" })).toBeInTheDocument();
    expect(textarea).toHaveValue("只记一次");
  });

  it("opens a fresh note after the previous capture is closed", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "先关掉" } });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("快速捕获")).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: "m", ctrlKey: true, shiftKey: true, repeat: true });
    expect(screen.queryByText("快速捕获")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    const next = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    expect(next).toHaveValue("");
  });

  it("disables save when text is empty", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    await waitFor(() => expect(screen.getByText("保存")).toBeInTheDocument());
    expect(screen.getByText("保存")).toBeDisabled();
  });

  it("reads 已保存 when capture succeeds and leaves focus in the field", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("⌘/Ctrl + Enter 保存")).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "重要想法" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已保存");
    expect(status).toHaveClass("sr-only");
    const shown = screen.getByText("已保存 ✓");
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(textarea).toHaveFocus();
    expect(screen.getByRole("button", { name: "已保存" })).not.toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads 已保存 when the save button is used and leaves focus on that button", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "点保存" } });
    const save = screen.getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已保存");
    expect(screen.getByRole("button", { name: "已保存" })).toHaveFocus();
    expect(textarea).not.toHaveFocus();
  });

  it("does not read a second result when capture fails", async () => {
    mockCreateMemory.mockRejectedValue(new MockApiError("保存失败", 500));
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "会失败" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(addError).toHaveBeenCalledWith("保存失败", "记忆"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("已保存 ✓")).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue("会失败");
  });

  it("saves memory on button click", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("想到什么，立刻记下来...")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("想到什么，立刻记下来..."), {
      target: { value: "重要想法" },
    });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(mockCreateMemory).toHaveBeenCalledWith({
        content: "重要想法",
        category: "quick_note",
      });
    });
  });

  it("saves on Cmd+Enter", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "快捷键保存" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(mockCreateMemory).toHaveBeenCalledWith({
        content: "快捷键保存",
        category: "quick_note",
      });
    });
  });

  it("closes on Escape", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("快速捕获")).not.toBeInTheDocument();
    });
  });

  it("calls addError when save fails", async () => {
    mockCreateMemory.mockRejectedValue(new MockApiError("保存失败", 500));
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("想到什么，立刻记下来...")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("想到什么，立刻记下来..."), {
      target: { value: "会失败" },
    });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(addError).toHaveBeenCalledWith("保存失败", "记忆");
    });
    expect(screen.getByPlaceholderText("想到什么，立刻记下来...")).toHaveValue("会失败");
    expect(screen.getByText("保存")).toBeEnabled();
  });

  it("does not save while an IME composition is confirming", async () => {
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "还在组字" } });
    expect(fireEvent.keyDown(textarea, { key: "Enter", metaKey: true, isComposing: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true, isComposing: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true, keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(textarea, { key: "Process", ctrlKey: true, keyCode: 229 })).toBe(true);
    expect(mockCreateMemory).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("还在组字");
  });

  it("ignores a second shortcut while the first save is in flight", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "只记一次" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(textarea).toBeEnabled();
    expect(mockCreateMemory).toHaveBeenCalledTimes(1);

    release({ id: "mem-1", status: "ok" });
    const done = await screen.findByRole("button", { name: "已保存" });
    expect(done).toBeEnabled();
    expect(textarea).toBeEnabled();
    expect(textarea).toHaveValue("只记一次");
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(mockCreateMemory).toHaveBeenCalledTimes(1);
  });

  it("keeps a new note when an earlier save finishes after cancel", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "先取消" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(textarea).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByText("快速捕获")).not.toBeInTheDocument());

    mockCreateMemory.mockResolvedValueOnce({ id: "mem-2", status: "ok" });
    openDialog();
    const next = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(next, { target: { value: "再记一条" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mockCreateMemory).toHaveBeenCalledWith({
        content: "再记一条",
        category: "quick_note",
      }),
    );

    release({ id: "mem-1", status: "ok" });
    expect(next).toHaveValue("再记一条");
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(mockCreateMemory).toHaveBeenCalledTimes(2);
  });

  it("keeps focus on save while the note is writing and after it fails", async () => {
    let fail: (err: unknown) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "会失败" } });
    const save = screen.getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(pending).toHaveFocus();
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(textarea).toBeEnabled();
    expect(mockCreateMemory).toHaveBeenCalledTimes(1);

    fail(new MockApiError("保存失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("保存失败", "记忆"));
    const again = screen.getByRole("button", { name: "保存" });
    expect(textarea).toHaveValue("会失败");
    expect(textarea).toBeEnabled();
    expect(again).toBeEnabled();
    expect(again).toHaveFocus();
    expect(again).not.toHaveAttribute("aria-busy");
  });

  it("keeps focus in the field when saving from the keyboard", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    await waitFor(() => expect(textarea).toHaveFocus());
    fireEvent.change(textarea, { target: { value: "快捷键保存" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(textarea).toHaveFocus();
    expect(textarea).toBeEnabled();
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    release({ id: "mem-1", status: "ok" });
    expect(await screen.findByRole("button", { name: "已保存" })).toBeEnabled();
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue("快捷键保存");
  });

  it("restores the field when focus was dropped before a failed save returns", async () => {
    let fail: (err: unknown) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "会失败" } });
    const save = screen.getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    await screen.findByRole("button", { name: "保存中..." });
    save.blur();
    const focusWhenFailed = captureFocusWhenSettled(() => {
      const button = screen.queryByRole("button", { name: "保存" });
      return button instanceof HTMLButtonElement && !button.hasAttribute("aria-busy");
    });
    await act(async () => {
      fail(new MockApiError("保存失败", 500));
    });
    expect(textarea).toHaveFocus();
    expect(focusWhenFailed.read()).toBe(textarea);
    expect(focusWhenFailed.read()).not.toBe(document.body);
    expect(textarea).toHaveValue("会失败");
    expect(textarea).toBeEnabled();
  });

  it("does not pull focus back when a failed save returns after focus moved", async () => {
    let fail: (err: unknown) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "会失败" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "保存中..." });
    const cancel = screen.getByRole("button", { name: "取消" });
    cancel.focus();
    fail(new MockApiError("保存失败", 500));
    await waitFor(() => expect(addError).toHaveBeenCalledWith("保存失败", "记忆"));
    expect(cancel).toHaveFocus();
    expect(textarea).toHaveValue("会失败");
  });

  it("keeps a newer draft and does not steal focus when the save finishes", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "先记" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await screen.findByRole("button", { name: "保存中..." });
    fireEvent.change(textarea, { target: { value: "先记，再补一句" } });
    const cancel = screen.getByRole("button", { name: "取消" });
    cancel.focus();
    release({ id: "mem-1", status: "ok" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "保存中..." })).not.toBeInTheDocument(),
    );
    expect(textarea).toHaveValue("先记，再补一句");
    expect(screen.getByText("快速捕获")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已保存" })).not.toBeInTheDocument();
    expect(cancel).toHaveFocus();
    expect(mockCreateMemory).toHaveBeenCalledTimes(1);
    expect(mockCreateMemory).toHaveBeenCalledWith({ content: "先记", category: "quick_note" });
  });

  it("moves focus to the field when a save finishes with a newer draft", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "先记" } });
    const save = screen.getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(pending).toHaveFocus();
    fireEvent.change(textarea, { target: { value: "先记，再补一句" } });
    const focusWhenSettled = captureFocusWhenSettled(
      () => !screen.queryByRole("button", { name: "保存中..." }),
    );
    await act(async () => {
      release({ id: "mem-1", status: "ok" });
    });
    expect(textarea).toHaveFocus();
    expect(focusWhenSettled.read()).toBe(textarea);
    expect(focusWhenSettled.read()).not.toBe(document.body);
    expect(textarea).toHaveValue("先记，再补一句");
    expect(screen.queryByRole("button", { name: "已保存" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("focuses the field before paint when a kept draft disables save", async () => {
    let release: (row: { id: string; status: string }) => void = () => {};
    mockCreateMemory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "先记" } });
    const save = screen.getByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    await screen.findByRole("button", { name: "保存中..." });
    fireEvent.change(textarea, { target: { value: "   " } });

    const focusWhenDisabled = captureFocusWhenSettled(() => {
      const button = screen.queryByRole("button", { name: "保存" });
      return button instanceof HTMLButtonElement && button.disabled;
    });
    await act(async () => {
      release({ id: "mem-1", status: "ok" });
    });
    expect(textarea).toHaveFocus();
    expect(focusWhenDisabled.read()).toBe(textarea);
    expect(focusWhenDisabled.read()).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(textarea).toHaveValue("   ");
    expect(screen.getByText("快速捕获")).toBeInTheDocument();
  });

  it("closes an unchanged note and returns focus to the opener", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "快捷捕获";
    document.body.appendChild(opener);
    opener.focus();
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    await waitFor(() => expect(textarea).toHaveFocus());
    fireEvent.change(textarea, { target: { value: "重要想法" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    const pending = await screen.findByRole("button", { name: "保存中..." });
    expect(pending).toBeEnabled();
    expect(textarea).toBeEnabled();
    expect(textarea).toHaveFocus();
    const done = await screen.findByRole("button", { name: "已保存" });
    expect(done).toBeEnabled();
    expect(textarea).toBeEnabled();
    let focusWhenClosed: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("快速捕获")) return;
      focusWhenClosed ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await waitFor(() => expect(screen.queryByText("快速捕获")).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(focusWhenClosed).toBe(opener);
    expect(opener).toHaveFocus();
    observer.disconnect();
    opener.remove();
  });

  it("keeps text typed after the note is saved and does not close", async () => {
    mockCreateMemory.mockResolvedValue({ id: "mem-1", status: "ok" });
    renderWithRouter(<QuickCaptureDialog />);
    openDialog();
    const textarea = await screen.findByPlaceholderText("想到什么，立刻记下来...");
    fireEvent.change(textarea, { target: { value: "重要想法" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "已保存" });
    fireEvent.change(textarea, { target: { value: "重要想法，再补一句" } });
    expect(textarea).toHaveValue("重要想法，再补一句");
    expect(screen.queryByRole("button", { name: "已保存" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
    expect(screen.getByText("快速捕获")).toBeInTheDocument();
    expect(textarea).toHaveValue("重要想法，再补一句");
  });
});
