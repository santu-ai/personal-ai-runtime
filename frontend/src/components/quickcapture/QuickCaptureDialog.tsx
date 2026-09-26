/**
 * QuickCaptureDialog — listens for the desktop's `quick-capture` postMessage
 * (triggered by the Alt+Shift+I global shortcut in Electron) and surfaces a
 * minimal input that saves directly to long-term memory as a quick_note.
 *
 * This closes the loop on desktop/main.js's quickCapture() — previously the
 * postMessage was sent but nothing in the renderer consumed it (dead code).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createMemory, ApiError } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";
import { Zap } from "lucide-react";
import { isImeKeyboardEvent } from "../../utils/imeKey";

type CaptureHandoff = "failed" | "draft";

/** 焦点掉到页面空白，或落在对话框面板上。 */
function focusLostOrPanel(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("role") === "dialog";
}

function onCaptureControl(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isConnected) return false;
  const mark = active.getAttribute("data-quick-capture");
  return mark === "field" || mark === "save";
}

/** 焦点在输入框、「保存」、对话框面板或页面空白处，才可以把焦点挪到输入框。 */
function captureFocusIdle(): boolean {
  return onCaptureControl() || focusLostOrPanel();
}

function focusCaptureField(): boolean {
  const field = document.querySelector<HTMLTextAreaElement>("[data-quick-capture='field']");
  if (!field || field.disabled) return false;
  if (document.activeElement !== field) field.focus();
  return document.activeElement === field;
}

/** 绘制前通知。测试在留下草稿、焦点交到输入框的同一轮读取焦点。 */
export const quickCaptureLayoutFocus = {
  notify: null as null | (() => void),
};

export default function QuickCaptureDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settle, setSettle] = useState(0);
  const savingRef = useRef(false);
  const saveGen = useRef(0);
  const textRef = useRef("");
  const submittedRef = useRef<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const handoff = useRef<CaptureHandoff | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const addError = useErrorStore((s) => s.addError);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const resetCapture = useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen;
    saveGen.current += 1;
    savingRef.current = false;
    submittedRef.current = null;
    handoff.current = null;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    textRef.current = "";
    setSaving(false);
    setSaved(false);
    setOpen(nextOpen);
    setText("");
  }, []);
  // 已经打开时再按快捷键，或再收到一次桌面捕获，不再清掉草稿，也不打断这次保存。
  const requestOpen = useCallback(() => {
    if (openRef.current) return;
    resetCapture(true);
  }, [resetCapture]);
  const dismiss = () => resetCapture(false);
  useOverlayDismiss(open, panelRef, dismiss, { initialFocus: "field" });

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // 留下的草稿交到输入框。空草稿会禁用「保存」，浏览器先把焦点卸到页面空白。
  // 放到绘制前，不先停在空白或已经禁用的按钮上。已经移到别的控件上就不再抢。
  useLayoutEffect(() => {
    if (!open || saving) return;
    const pending = handoff.current;
    if (!pending) return;
    if (pending === "failed") {
      if (onCaptureControl()) {
        handoff.current = null;
        return;
      }
      if (!focusLostOrPanel()) {
        handoff.current = null;
        return;
      }
      if (focusCaptureField()) handoff.current = null;
      return;
    }
    if (!captureFocusIdle()) {
      handoff.current = null;
      return;
    }
    if (focusCaptureField()) handoff.current = null;
  }, [open, saving, settle]);

  useLayoutEffect(() => {
    quickCaptureLayoutFocus.notify?.();
  });

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.type === "quick-capture") {
        requestOpen();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [requestOpen]);

  // Also bind a web keyboard shortcut (Ctrl/Cmd+Shift+M) for non-Electron use.
  // 连发和组字时的这一下不打开。已经打开时不再清掉草稿。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "m") return;
      if (e.repeat || isImeKeyboardEvent(e)) return;
      e.preventDefault();
      requestOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestOpen]);

  const noteDraftKept = () => {
    savingRef.current = false;
    submittedRef.current = null;
    clearCloseTimer();
    setSaved(false);
    handoff.current = "draft";
    setSettle((n) => n + 1);
  };

  const handleText = (value: string) => {
    textRef.current = value;
    setText(value);
    if (submittedRef.current !== null && value !== submittedRef.current) {
      noteDraftKept();
    }
  };

  const handleSave = async () => {
    const content = textRef.current.trim();
    if (!content || savingRef.current) return;
    const gen = saveGen.current;
    const submitted = textRef.current;
    savingRef.current = true;
    handoff.current = null;
    setSaving(true);
    let ok = false;
    try {
      await createMemory({ content, category: "quick_note" });
      if (saveGen.current !== gen) return;
      ok = true;
    } catch (e) {
      if (saveGen.current !== gen) return;
      addError(e instanceof ApiError ? e.message : "快速捕获失败", "记忆");
    } finally {
      if (saveGen.current === gen) setSaving(false);
    }
    if (saveGen.current !== gen) return;
    if (!ok) {
      savingRef.current = false;
      handoff.current = "failed";
      setSettle((n) => n + 1);
      return;
    }
    if (textRef.current !== submitted) {
      noteDraftKept();
      return;
    }
    submittedRef.current = submitted;
    setSaved(true);
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (saveGen.current !== gen) return;
      if (textRef.current !== submitted) {
        noteDraftKept();
        return;
      }
      submittedRef.current = null;
      savingRef.current = false;
      textRef.current = "";
      openRef.current = false;
      setSaved(false);
      setText("");
      setOpen(false);
    }, 900);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (isImeKeyboardEvent(e.nativeEvent)) return;
    void handleSave();
  };

  if (!open) return null;

  const saveLocked = saving || saved;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] pt-[20vh]"
      onClick={dismiss}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
        tabIndex={-1}
        className="bg-surface-raised border border-border-strong rounded-xl shadow-2xl w-[28rem] max-w-[90vw] overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <Zap size={14} className="text-warning" />
          <span id="quick-capture-title" className="text-sm font-medium text-fg-primary">
            快速捕获
          </span>
          <span className="text-xs text-fg-disabled ml-auto">
            {saved ? "已保存 ✓" : "⌘/Ctrl + Enter 保存"}
          </span>
        </div>
        <textarea
          value={text}
          data-quick-capture="field"
          onChange={(e) => handleText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="想到什么，立刻记下来..."
          className="h-28 w-full resize-none bg-transparent px-4 py-3 text-sm text-fg-primary placeholder:text-fg-tertiary rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
        />
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle bg-surface-sunken/50">
          <span className="text-xs text-fg-disabled">保存为 quick_note 记忆</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="px-3 py-1 text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
            >
              取消
            </button>
            <button
              type="button"
              data-quick-capture="save"
              onClick={() => void handleSave()}
              disabled={!text.trim() && !saveLocked}
              aria-busy={saving || undefined}
              className={`px-3 py-1 text-xs bg-surface-overlay hover:bg-border-strong disabled:opacity-40 disabled:cursor-not-allowed rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                saving ? " opacity-50" : ""
              }`}
            >
              {saving ? "保存中..." : saved ? "已保存" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
