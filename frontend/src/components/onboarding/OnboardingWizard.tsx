import { useId, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Brain, Mail, MessageSquare, Target } from "lucide-react";
import { getSystemHealth, getLlmProviders, createConversation, ApiError } from "../../api/client";
import { useChatStore } from "../../stores/chatStore";
import { useErrorStore } from "../../stores/errorStore";
import { useConversationCacheActions } from "../../hooks/useConversationsQuery";
import Button from "../ui/Button";
import Card from "../ui/Card";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";

const STEPS = [
  { title: "连接后端", description: "确认 Personal AI Runtime 后端已启动" },
  { title: "配置 AI 大脑", description: "设置 LLM 模型，让 AI 可以思考和对话" },
  { title: "开始第一次对话", description: "选一个话题，立即体验 AI 能为你做什么" },
];

const STARTER_PROMPTS: Array<{
  icon: LucideIcon;
  label: string;
  prompt: string;
  title: string;
}> = [
  {
    icon: Target,
    label: "帮我规划一个目标",
    prompt: "帮我设定一个这周想完成的目标，拆解成可执行的步骤",
    title: "目标规划",
  },
  {
    icon: Mail,
    label: "总结我的收件箱",
    prompt: "帮我看看收件箱里有什么重要的邮件，总结一下需要我处理的",
    title: "收件箱摘要",
  },
  {
    icon: Brain,
    label: "记下关于我的事",
    prompt: "我想让你记住一些关于我的事情：我的工作、兴趣和习惯，方便以后更好地帮助我",
    title: "建立记忆",
  },
  { icon: MessageSquare, label: "自由聊几句", prompt: "", title: "新对话" },
];

type CheckAction = "check" | "next";

/** 焦点在页面空白处，或还停在这次点的控件上，才安放。已经在别的控件上就不再抢。 */
function focusIsIdle(attr: string, value: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute(attr) === value;
}

function focusMarked(attr: string, value: string): boolean {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const node = document.querySelector<HTMLElement>(`[${attr}="${escaped}"]`);
  if (!node || (node instanceof HTMLButtonElement && node.disabled)) return false;
  node.focus();
  return document.activeElement === node;
}

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const navigate = useNavigate();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);
  const addError = useErrorStore((s) => s.addError);
  const { upsert } = useConversationCacheActions();

  const [step, setStep] = useState(0);
  const [checkBusy, setCheckBusy] = useState<CheckAction | null>(null);
  const [launchingLabel, setLaunchingLabel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);
  const checkLock = useRef(false);
  const launchLock = useRef(false);
  const checkFailFocus = useRef<CheckAction | null>(null);
  const stepHandoff = useRef<number | null>(null);
  const launchFailFocus = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const leave = () => {
    localStorage.setItem("onboarding_done", "1");
    onComplete();
  };

  /** 检查或创建还没回来时，Esc 不离开。点外面也不离开。 */
  const dismiss = () => {
    if (checkLock.current || launchLock.current) return;
    leave();
  };

  useOverlayDismiss(true, panelRef, dismiss);

  useLayoutEffect(() => {
    if (checkBusy !== null) return;
    const action = checkFailFocus.current;
    if (!action) return;
    checkFailFocus.current = null;
    if (!focusIsIdle("data-onboarding-action", action)) return;
    focusMarked("data-onboarding-action", action);
  }, [checkBusy]);

  useLayoutEffect(() => {
    if (checkBusy !== null) return;
    const target = stepHandoff.current;
    if (target === null || target !== step) return;
    stepHandoff.current = null;
    if (!focusIsIdle("data-onboarding-action", "next")) return;
    if (step >= 2) {
      focusMarked("data-onboarding-starter", STARTER_PROMPTS[0].label);
      return;
    }
    focusMarked("data-onboarding-action", "next");
  }, [checkBusy, step]);

  useLayoutEffect(() => {
    if (launchingLabel !== null) return;
    const label = launchFailFocus.current;
    if (!label) return;
    launchFailFocus.current = null;
    if (!focusIsIdle("data-onboarding-starter", label)) return;
    focusMarked("data-onboarding-starter", label);
  }, [launchingLabel]);

  const checkHealth = async (): Promise<{ ok: true; configured: boolean } | { ok: false }> => {
    try {
      const health = await getSystemHealth();
      const configured = health?.startup?.checks?.llm?.configured ?? false;
      setMessage("后端运行正常");
      setMessageOk(true);
      return { ok: true, configured };
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "无法连接后端，请先启动服务");
      setMessageOk(false);
      return { ok: false };
    }
  };

  const checkLlm = async (): Promise<boolean> => {
    try {
      const res = await getLlmProviders();
      const count = res.providers?.length ?? 0;
      if (count === 0) {
        setMessage("未检测到 LLM 提供商。无需编辑 .env 文件，在设置中直接配置即可。");
        setMessageOk(false);
        return false;
      }
      setMessage(`已就绪，默认模型：${res.default}`);
      setMessageOk(true);
      return true;
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "检查 LLM 失败");
      setMessageOk(false);
      return false;
    }
  };

  const runExplicitCheck = async () => {
    if (checkLock.current) return;
    const current = step;
    checkLock.current = true;
    setCheckBusy("check");
    checkFailFocus.current = null;
    let ok = false;
    try {
      ok = current === 0 ? (await checkHealth()).ok : await checkLlm();
    } finally {
      if (!ok) checkFailFocus.current = "check";
      checkLock.current = false;
      setCheckBusy(null);
    }
  };

  const handleNext = async () => {
    if (step >= 2) {
      leave();
      return;
    }
    if (checkLock.current) return;
    const current = step;
    checkLock.current = true;
    setCheckBusy("next");
    checkFailFocus.current = null;
    stepHandoff.current = null;
    let ok = false;
    try {
      if (current === 0) {
        const result = await checkHealth();
        ok = result.ok;
        if (result.ok) {
          const next = result.configured ? 2 : 1;
          stepHandoff.current = next;
          setStep(next);
          setMessage("");
        }
      } else {
        ok = await checkLlm();
        if (ok) {
          stepHandoff.current = 2;
          setStep(2);
          setMessage("");
        }
      }
    } finally {
      if (!ok) checkFailFocus.current = "next";
      checkLock.current = false;
      setCheckBusy(null);
    }
  };

  const launchConversation = async (promptText: string, title: string, label: string) => {
    if (launchLock.current) return;
    launchLock.current = true;
    setLaunchingLabel(label);
    launchFailFocus.current = null;
    let ok = false;
    try {
      const conv = await createConversation(title);
      upsert(conv);
      setActiveConversation(conv.id);
      if (promptText) setPendingPrompt(promptText);
      ok = true;
      navigate(`/chat/${conv.id}`);
      leave();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建对话失败";
      addError(msg, "对话");
    } finally {
      if (!ok) launchFailFocus.current = label;
      launchLock.current = false;
      setLaunchingLabel(null);
    }
  };

  const goToSettings = () => {
    leave();
    navigate("/settings");
  };

  const current = STEPS[step];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      data-testid="onboarding-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-w-md w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Card className="w-full">
          <div className="text-xs text-insight mb-2">
            首次引导 {step + 1}/{STEPS.length}
          </div>
          <h2 id={titleId} className="text-xl font-semibold text-fg-primary">
            {current.title}
          </h2>
          <p className="text-sm text-fg-secondary mt-2">{current.description}</p>

          {step < 2 && (
            <div className="mt-4">
              <Button
                size="sm"
                variant="secondary"
                data-onboarding-action="check"
                aria-busy={checkBusy === "check" || undefined}
                className={checkBusy === "check" ? "opacity-50" : ""}
                onClick={() => void runExplicitCheck()}
              >
                {checkBusy === "check" ? "检查中…" : "运行检查"}
              </Button>
              {message && (
                <p className={`text-xs mt-2 ${messageOk ? "text-success" : "text-danger"}`}>
                  {message}
                </p>
              )}
              {step === 1 && !messageOk && checkBusy === null && (
                <div className="mt-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                  <p className="text-xs text-warning mb-2">
                    推荐使用 DeepSeek（注册即送免费额度），或在设置中添加你想用的任何兼容 OpenAI API
                    的模型。
                  </p>
                  <Button size="sm" variant="secondary" onClick={goToSettings}>
                    前往设置页面配置
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-fg-tertiary mb-3">
                一切就绪。选一个开始——你的 AI 会立即响应：
              </p>
              {STARTER_PROMPTS.map((sp) => {
                const Icon = sp.icon;
                const busy = launchingLabel === sp.label;
                return (
                  <button
                    key={sp.label}
                    type="button"
                    data-onboarding-starter={sp.label}
                    aria-busy={busy || undefined}
                    onClick={() => void launchConversation(sp.prompt, sp.title, sp.label)}
                    className={`w-full flex items-center gap-3 p-3 bg-surface-overlay/50 hover:bg-surface-overlay border border-border-subtle hover:border-border-strong rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${busy ? " opacity-50" : ""}`}
                  >
                    <Icon size={18} className="text-insight shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg-primary">{sp.label}</div>
                      {sp.prompt && (
                        <div className="text-xs text-fg-tertiary truncate mt-0.5">{sp.prompt}</div>
                      )}
                    </div>
                  </button>
                );
              })}
              {launchingLabel && (
                <p className="text-xs text-fg-secondary text-center pt-2">正在开启对话…</p>
              )}
            </div>
          )}

          <div className="flex justify-between mt-6">
            <Button size="sm" variant="ghost" onClick={leave}>
              {step === 2 ? "稍后再说" : "跳过"}
            </Button>
            {step < 2 && (
              <Button
                size="sm"
                data-onboarding-action="next"
                aria-busy={checkBusy === "next" || undefined}
                className={checkBusy === "next" ? "opacity-50" : ""}
                onClick={() => void handleNext()}
              >
                {checkBusy === "next" ? "检查中…" : "下一步"}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
