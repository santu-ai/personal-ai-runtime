import { useEffect, useState } from "react";
import {
  getTelegramGatewayStatus,
  pollTelegramGateway,
  updateTelegramGateway,
  type TelegramGatewayStatus,
} from "../../api/settings";
import Button from "../ui/Button";
import Badge from "../ui/Badge";

export default function TelegramGatewayCard() {
  const [status, setStatus] = useState<TelegramGatewayStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getTelegramGatewayStatus().then((next) => {
      setStatus(next);
      setEnabled(next.enabled);
      setAutoReply(next.auto_reply);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const next = await updateTelegramGateway(enabled, autoReply);
      setStatus(next);
      setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const poll = async () => {
    setBusy(true);
    try {
      const result = await pollTelegramGateway();
      setMessage(
        result.status === "ok" ? `轮询完成，处理 ${result.processed} 条消息` : result.error || "轮询失败",
      );
      setStatus(await getTelegramGatewayStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "轮询失败");
    } finally {
      setBusy(false);
    }
  };

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
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用每分钟本地轮询
      </label>
      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={autoReply}
          onChange={(e) => setAutoReply(e.target.checked)}
        />
        启用当前 Chat ID 的一次性自动回复授权
      </label>
      <p className="text-xs text-fg-tertiary">
        自动回复关闭时，每条 Telegram 回复都需要人工批准。凭据仅从环境变量读取。
      </p>
      {status.last_error && <p className="text-xs text-danger">最近错误：{status.last_error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={busy}>保存</Button>
        <Button variant="secondary" onClick={() => void poll()} disabled={busy || !enabled}>
          立即轮询
        </Button>
        {message && <span className="text-xs text-fg-tertiary">{message}</span>}
      </div>
    </div>
  );
}
