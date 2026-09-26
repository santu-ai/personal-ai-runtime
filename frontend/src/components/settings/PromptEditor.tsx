import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPromptConfig, updatePromptConfig } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { usePromptConfigQuery } from "../../hooks/useSettingsQuery";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";

type PromptField = "identity" | "coding_rules";
type PromptAction = "save" | "reset";
type PromptBusy = { field: PromptField; action: PromptAction };

function focusIsIdle(stale?: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (stale && active === stale) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

export default function PromptEditor() {
  const identityId = useId();
  const codingRulesId = useId();
  const addError = useErrorStore((s) => s.addError);
  const queryClient = useQueryClient();
  const { data: cfg, isLoading, isFetching, error, refetch } = usePromptConfigQuery();
  const shownError = useHeldQueryError(
    Boolean(cfg),
    error,
    isFetching,
    "加载人设配置失败",
    "prompt",
  );
  const [identity, setIdentity] = useState("");
  const [codingRules, setCodingRules] = useState("");
  const [isCustomIdentity, setIsCustomIdentity] = useState(false);
  const [isCustomCodingRules, setIsCustomCodingRules] = useState(false);
  const [busy, setBusy] = useState<PromptBusy | null>(null);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const savingRef = useRef(false);
  const fieldGen = useRef({ identity: 0, coding_rules: 0 });
  const noticeToken = useRef(0);
  const focusAfter = useRef<PromptBusy | null>(null);

  const touch = (field: PromptField) => {
    fieldGen.current[field] += 1;
    noticeToken.current += 1;
    setMessage("");
  };

  const showNotice = (text: string, temporary: boolean) => {
    const token = ++noticeToken.current;
    setMessage(text);
    if (!temporary) return;
    window.setTimeout(() => {
      if (noticeToken.current === token) setMessage("");
    }, 2000);
  };

  useEffect(() => {
    if (error) {
      addError(queryErrorMessage(error, "加载人设配置失败"), "设置");
    }
  }, [error, addError]);

  useEffect(() => {
    if (cfg && !hydrated) {
      setIdentity(cfg.identity);
      setCodingRules(cfg.coding_rules);
      setIsCustomIdentity(cfg.is_custom_identity);
      setIsCustomCodingRules(cfg.is_custom_coding_rules);
      setHydrated(true);
    }
  }, [cfg, hydrated]);

  // 重置成功会禁用「重置」。放到绘制前，观察 DOM 的那一轮才不会停在已经禁用的按钮上。
  useLayoutEffect(() => {
    const handoff = focusAfter.current;
    if (!handoff || busy) return;
    focusAfter.current = null;
    if (handoff.action !== "reset") return;
    const reset = document.querySelector<HTMLButtonElement>(
      `[data-prompt-field="${handoff.field}"][data-prompt-action="reset"]`,
    );
    if (!focusIsIdle(reset)) return;
    document
      .querySelector<HTMLElement>(`[data-prompt-field="${handoff.field}"][data-prompt-input]`)
      ?.focus();
  }, [busy, isCustomIdentity, isCustomCodingRules]);

  const run = async (field: PromptField, action: PromptAction) => {
    if (savingRef.current) return;
    const custom = field === "identity" ? isCustomIdentity : isCustomCodingRules;
    if (action === "reset" && !custom) return;
    const gen = fieldGen.current[field];
    const sent = field === "identity" ? identity : codingRules;
    savingRef.current = true;
    setBusy({ field, action });
    setMessage("");
    try {
      if (action === "save") {
        const payload = field === "identity" ? { identity: sent } : { coding_rules: sent };
        await updatePromptConfig(payload);
        void queryClient.invalidateQueries({ queryKey: queryKeys.promptConfig });
        if (fieldGen.current[field] !== gen) return;
        if (field === "identity") setIsCustomIdentity(!!sent.trim());
        else setIsCustomCodingRules(!!sent.trim());
        showNotice("已保存", true);
        return;
      }
      await updatePromptConfig({ [field]: "" });
      const next = await getPromptConfig();
      void queryClient.invalidateQueries({ queryKey: queryKeys.promptConfig });
      if (fieldGen.current[field] !== gen) return;
      if (field === "identity") {
        setIdentity(next.identity);
        setIsCustomIdentity(false);
      } else {
        setCodingRules(next.coding_rules);
        setIsCustomCodingRules(false);
      }
      showNotice("已重置为默认", true);
      focusAfter.current = { field, action: "reset" };
    } catch {
      showNotice(action === "save" ? "保存失败" : "重置失败", false);
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  };

  if (shownError) {
    return (
      <LoadErrorNotice
        message={shownError}
        busy={isFetching}
        onRetry={() => void refetch()}
        testId="prompt-load-error"
      />
    );
  }

  if (isLoading && !hydrated) {
    return <p className="text-xs text-fg-disabled">加载人设中…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={identityId} className="text-xs text-fg-secondary">
            身份定义 {isCustomIdentity && <span className="text-insight">(已自定义)</span>}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-prompt-field="identity"
              data-prompt-action="reset"
              onClick={() => void run("identity", "reset")}
              disabled={!isCustomIdentity}
              aria-busy={busy?.field === "identity" && busy.action === "reset" ? true : undefined}
              className={`text-xs text-fg-disabled hover:text-fg-tertiary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded${
                busy?.field === "identity" && busy.action === "reset" ? " opacity-50" : ""
              }`}
            >
              {busy?.field === "identity" && busy.action === "reset" ? "重置中…" : "重置"}
            </button>
            <button
              type="button"
              data-prompt-field="identity"
              data-prompt-action="save"
              onClick={() => void run("identity", "save")}
              aria-busy={busy?.field === "identity" && busy.action === "save" ? true : undefined}
              className={`text-xs px-2 py-0.5 bg-surface-overlay hover:bg-border-strong rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                busy?.field === "identity" && busy.action === "save" ? " opacity-50" : ""
              }`}
            >
              {busy?.field === "identity" && busy.action === "save" ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
        <textarea
          id={identityId}
          data-prompt-field="identity"
          data-prompt-input=""
          value={identity}
          onChange={(e) => {
            setIdentity(e.target.value);
            touch("identity");
          }}
          rows={6}
          className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary font-mono focus:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring resize-y placeholder:text-fg-tertiary"
          placeholder="定义 AI 的身份、性格、行为准则..."
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={codingRulesId} className="text-xs text-fg-secondary">
            代码规则 {isCustomCodingRules && <span className="text-insight">(已自定义)</span>}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-prompt-field="coding_rules"
              data-prompt-action="reset"
              onClick={() => void run("coding_rules", "reset")}
              disabled={!isCustomCodingRules}
              aria-busy={
                busy?.field === "coding_rules" && busy.action === "reset" ? true : undefined
              }
              className={`text-xs text-fg-disabled hover:text-fg-tertiary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded${
                busy?.field === "coding_rules" && busy.action === "reset" ? " opacity-50" : ""
              }`}
            >
              {busy?.field === "coding_rules" && busy.action === "reset" ? "重置中…" : "重置"}
            </button>
            <button
              type="button"
              data-prompt-field="coding_rules"
              data-prompt-action="save"
              onClick={() => void run("coding_rules", "save")}
              aria-busy={
                busy?.field === "coding_rules" && busy.action === "save" ? true : undefined
              }
              className={`text-xs px-2 py-0.5 bg-surface-overlay hover:bg-border-strong rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                busy?.field === "coding_rules" && busy.action === "save" ? " opacity-50" : ""
              }`}
            >
              {busy?.field === "coding_rules" && busy.action === "save" ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
        <textarea
          id={codingRulesId}
          data-prompt-field="coding_rules"
          data-prompt-input=""
          value={codingRules}
          onChange={(e) => {
            setCodingRules(e.target.value);
            touch("coding_rules");
          }}
          rows={6}
          className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary font-mono focus:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring resize-y placeholder:text-fg-tertiary"
          placeholder="定义 AI 编码时的行为规则..."
        />
      </div>
      {message && (
        <p
          className={`text-xs ${message.includes("失败") ? "text-danger" : "text-success"}`}
          role={message.includes("失败") ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
