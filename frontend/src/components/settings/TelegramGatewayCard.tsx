import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getTelegramGatewayStatus,
  pollTelegramGateway,
  updateTelegramGateway,
  type TelegramGatewayStatus,
} from "../../api/settings";
import { useErrorStore } from "../../stores/errorStore";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import LoadErrorNotice, { queryErrorMessage } from "../ui/LoadErrorNotice";

export default function TelegramGatewayCard() {
  const addError = useErrorStore((s) => s.addError);
  const reportError = useRef(addError);
  reportError.current = addError;
  const [status, setStatus] = useState<TelegramGatewayStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "poll" | null>(null);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const saveGen = useRef(0);
  const enabledRef = useRef(false);
  const focusAfterPoll = useRef(false);
  enabledRef.current = enabled;

  const touch = () => {
    saveGen.current += 1;
    setMessage("");
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getTelegramGatewayStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setEnabled(next.enabled);
        setAutoReply(next.auto_reply);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const text = queryErrorMessage(error, "加载 Telegram 状态失败");
        setLoadError(text);
        reportError.current(text, "设置");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 关掉开关后再结束轮询，会禁用「立即轮询」。放到绘制前，才不会停在已经禁用的按钮上。
  useLayoutEffect(() => {
    if (busyAction || !focusAfterPoll.current) return;
    focusAfterPoll.current = false;
    const pollButton = document.querySelector<HTMLButtonElement>("[data-telegram-action='poll']");
    if (pollButton && !pollButton.disabled) return;
    const active = document.activeElement;
    const idle =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      active === pollButton ||
      !(active instanceof HTMLElement) ||
      !active.isConnected;
    if (!idle) return;
    document.querySelector<HTMLElement>("[data-telegram-action='save']")?.focus();
  }, [busyAction, enabled]);

  const save = async () => {
    if (busyRef.current) return;
    const gen = saveGen.current;
    busyRef.current = true;
    setBusyAction("save");
    setMessage("");
    try {
      const next = await updateTelegramGateway(enabled, autoReply);
      setStatus(next);
      if (saveGen.current === gen) setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  };

  const poll = async () => {
    if (busyRef.current || !enabledRef.current) return;
    busyRef.current = true;
    setBusyAction("poll");
    try {
      const result = await pollTelegramGateway();
      setMessage(
        result.status === "ok"
          ? `轮询完成，处理 ${result.processed} 条消息`
          : result.error || "轮询失败",
      );
      setStatus(await getTelegramGatewayStatus());
      if (!enabledRef.current) focusAfterPoll.current = true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "轮询失败");
      if (!enabledRef.current) focusAfterPoll.current = true;
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  };

  if (!status && loadError) {
    return (
      <LoadErrorNotice
        message={loadError}
        busy={loading}
        onRetry={() => {
          if (loading) return;
          setAttempt((value) => value + 1);
        }}
        testId="telegram-load-error"
      />
    );
  }

  if (!status) return <p className="text-sm text-fg-tertiary">加载 Telegram 状态…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge tone={status.connected ? "success" : "warning"}>
          {status.connected ? "已连接" : "未连接"}
        </Badge>
        <span className="text-xs text-fg-tertiary">
          Token {status.token_configured ? "已配置" : "未配置"} · Chat ID{" "}
          {status.chat_configured ? "已配置" : "未配置"}
        </span>
      </div>
      {!status.capability_enabled && (
        <p className="text-xs text-warning">
          需在 BUILTIN_TOOL_CATEGORIES 中启用 telegram 后重启后端。
        </p>
      )}
      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            touch();
          }}
        />
        启用每分钟本地轮询
      </label>
      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={autoReply}
          onChange={(e) => {
            setAutoReply(e.target.checked);
            touch();
          }}
        />
        启用当前 Chat ID 的一次性自动回复授权
      </label>
      <p className="text-xs text-fg-tertiary">
        自动回复关闭时，每条 Telegram 回复都需要人工批准。凭据仅从环境变量读取。
      </p>
      {status.last_error && <p className="text-xs text-danger">最近错误：{status.last_error}</p>}
      {(status.last_polled_at || status.last_update_id > 0) && (
        <p className="text-xs text-fg-tertiary">
          最近轮询 {status.last_polled_at || "尚未"} · update {status.last_update_id}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          data-telegram-action="save"
          onClick={() => void save()}
          aria-busy={busyAction === "save" || undefined}
          className={busyAction === "save" ? "opacity-50" : ""}
        >
          {busyAction === "save" ? "保存中…" : "保存"}
        </Button>
        <Button
          variant="secondary"
          data-telegram-action="poll"
          onClick={() => void poll()}
          disabled={!enabled && busyAction !== "poll"}
          aria-busy={busyAction === "poll" || undefined}
          className={busyAction === "poll" ? "opacity-50" : ""}
        >
          {busyAction === "poll" ? "轮询中…" : "立即轮询"}
        </Button>
        {message && <span className="text-xs text-fg-tertiary">{message}</span>}
      </div>
    </div>
  );
}
