import { useId, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Mail, Target } from "lucide-react";
import { getSystemHealth, getLlmProviders, createProjectBrief, ApiError } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import Button from "../ui/Button";
import Card from "../ui/Card";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";

const STEPS = [
  { title: "连接后端", description: "确认 Personal AI Runtime 后端已启动" },
  { title: "配置 AI 大脑", description: "设置 LLM 模型，让 AI 可以思考和对话" },
  { title: "生成第一份简报", description: "选一个场景，接上邮箱，打开一份可以核对来源的交付" },
];

const BRIEF_SCENES: Array<{
  icon: LucideIcon;
  label: string;
  detail: string;
  title: string;
  objective: string;
  email: { enabled: boolean; query?: string; days: number };
}> = [
  {
    icon: Mail,
    label: "整理最近邮件",
    detail: "读取最近三天的邮件，生成一份可以核对来源的简报",
    title: "最近邮件简报",
    objective: "整理最近三天邮件里的变化、风险和待办，每条结论附上来源。",
    email: { enabled: true, days: 3 },
  },
  {
    icon: Target,
    label: "核对预算邮件",
    detail: "先按「预算」检索邮箱，再读命中的正文",
    title: "预算简报",
    objective: "找出最近邮件里的预算金额，标出缺失和互相矛盾的地方。",
    email: { enabled: true, query: "预算", days: 7 },
  },
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
  const addError = useErrorStore((s) => s.addError);

  const [step, setStep] = useState(0);
  const [checkBusy, setCheckBusy] = useState<CheckAction | null>(null);
  const [launchingLabel, setLaunchingLabel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
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
      focusMarked("data-onboarding-starter", BRIEF_SCENES[0].label);
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
      const emailConfigured = health?.startup?.checks?.email?.configured;
      setModelReady(configured);
      if (typeof emailConfigured === "boolean") setEmailReady(emailConfigured);
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

  const launchBrief = async (scene: (typeof BRIEF_SCENES)[number]) => {
    if (launchLock.current) return;
    launchLock.current = true;
    setLaunchingLabel(scene.label);
    launchFailFocus.current = null;
    let ok = false;
    try {
      const item = await createProjectBrief({
        title: scene.title,
        objective: scene.objective,
        source_scope: { email: scene.email },
      });
      ok = true;
      navigate(`/tasks/${item.id}`);
      leave();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建简报失败";
      addError(msg, "简报");
    } finally {
      if (!ok) launchFailFocus.current = scene.label;
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
                <p
                  className={`text-xs mt-2 ${messageOk ? "text-success" : "text-danger"}`}
                  role={messageOk ? "status" : "alert"}
                >
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
              {modelReady ? (
                <p className="text-xs text-fg-secondary">模型已经配好，所以跳过了配置模型。</p>
              ) : null}
              {emailReady === false ? (
                <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
                  <p className="text-xs text-warning mb-2">
                    邮箱还没接上。下面的场景会去读邮箱。先到设置里保存邮箱并测试连接，再执行。没有邮箱时，点「稍后再说」，到任务页新建简报，只填资料路径。
                  </p>
                  <Button size="sm" variant="secondary" onClick={goToSettings}>
                    前往设置
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-fg-tertiary mb-3">
                  选一个场景。打开后可以执行、核对来源、验收，并预约下一次。
                </p>
              )}
              {BRIEF_SCENES.map((scene) => {
                const Icon = scene.icon;
                const busy = launchingLabel === scene.label;
                return (
                  <button
                    key={scene.label}
                    type="button"
                    data-onboarding-starter={scene.label}
                    aria-busy={busy || undefined}
                    onClick={() => void launchBrief(scene)}
                    className={`group w-full flex items-center gap-3 p-3 bg-surface-overlay/50 hover:bg-surface-overlay border border-border-subtle hover:border-border-strong rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${busy ? " opacity-50" : ""}`}
                  >
                    <Icon size={18} className="text-insight shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg-primary">{scene.label}</div>
                      {/* 说明平时只占一行。键盘落到这一题时写出整句。鼠标悬停仍是一行。 */}
                      <div className="text-xs text-fg-tertiary mt-0.5 truncate group-focus-visible:overflow-visible group-focus-visible:whitespace-normal group-focus-visible:text-clip group-focus-visible:break-words">
                        {scene.detail}
                      </div>
                    </div>
                  </button>
                );
              })}
              {launchingLabel && (
                <p className="text-xs text-fg-secondary text-center pt-2">正在生成简报…</p>
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
