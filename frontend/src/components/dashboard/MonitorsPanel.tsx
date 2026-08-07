import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/core";
import {
  checkUrlMonitors,
  createInboxFilter,
  createUrlMonitor,
  deleteInboxFilter,
  deleteUrlMonitor,
  listInboxFilters,
  listUrlMonitors,
  updateInboxFilter,
  updateUrlMonitor,
  type InboxFilter,
  type UrlMonitor,
} from "../../api/monitors";
import { useErrorStore } from "../../stores/errorStore";
import Button from "../ui/Button";
import { Input } from "../ui/Input";
import EmptyState from "../ui/EmptyState";
import { Radar } from "lucide-react";
import { timeAgo } from "../../utils/timeUtils";

export default function MonitorsPanel() {
  const addError = useErrorStore((s) => s.addError);
  const [filters, setFilters] = useState<InboxFilter[]>([]);
  const [urlMonitors, setUrlMonitors] = useState<UrlMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");

  const [urlName, setUrlName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlInterval, setUrlInterval] = useState("60");
  const [checkHint, setCheckHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [inbox, urls] = await Promise.all([listInboxFilters(), listUrlMonitors()]);
      setFilters(inbox);
      setUrlMonitors(urls);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "加载监控规则失败", "监控");
    } finally {
      setLoading(false);
    }
  }, [addError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateInbox = async () => {
    if (!name.trim() || (!sender.trim() && !subject.trim())) return;
    setBusy(true);
    try {
      await createInboxFilter({
        name: name.trim(),
        sender_contains: sender.trim(),
        subject_contains: subject.trim(),
      });
      setName("");
      setSender("");
      setSubject("");
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleInbox = async (f: InboxFilter) => {
    setBusy(true);
    try {
      await updateInboxFilter(f.id, { enabled: !f.enabled });
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteInbox = async (id: string) => {
    setBusy(true);
    try {
      await deleteInboxFilter(id);
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUrl = async () => {
    if (!urlName.trim() || !urlValue.trim()) return;
    const interval = Number(urlInterval) || 60;
    setBusy(true);
    try {
      await createUrlMonitor({
        name: urlName.trim(),
        url: urlValue.trim(),
        check_interval_minutes: interval,
      });
      setUrlName("");
      setUrlValue("");
      setUrlInterval("60");
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleUrl = async (m: UrlMonitor) => {
    setBusy(true);
    try {
      await updateUrlMonitor(m.id, { enabled: !m.enabled });
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUrl = async (id: string) => {
    setBusy(true);
    try {
      await deleteUrlMonitor(id);
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  const handleCheckNow = async () => {
    setBusy(true);
    setCheckHint(null);
    try {
      const result = await checkUrlMonitors(true);
      setCheckHint(
        result.notified > 0 ? `检查完成：${result.notified} 处有更新` : "检查完成：暂无变化",
      );
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "检查失败", "监控");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-fg-tertiary py-8 text-center">加载中…</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-fg-secondary">
        收件箱过滤器在每次邮件拉取后求值；网页监控按间隔抓取正文，内容变化时才通知一次。
      </p>

      {/* ── Inbox filters ── */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-fg-primary">收件箱过滤器</h3>
        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
          <Input
            placeholder="名称（如：老板）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="发件人包含（可空）"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
          <Input
            placeholder="主题包含（可空）"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !name.trim() || (!sender.trim() && !subject.trim())}
            onClick={handleCreateInbox}
          >
            添加过滤器
          </Button>
        </div>

        {filters.length === 0 ? (
          <EmptyState
            icon={<Radar className="w-8 h-8" />}
            title="暂无邮件规则"
            description="添加一条发件人或主题规则，有匹配新邮件时再通知你。"
          />
        ) : (
          <ul className="space-y-2">
            {filters.map((f) => (
              <li
                key={f.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-fg-primary font-medium truncate">{f.name}</div>
                  <div className="text-xs text-fg-tertiary mt-0.5">
                    {f.sender_contains ? `发件人含「${f.sender_contains}」` : null}
                    {f.sender_contains && f.subject_contains ? " · " : null}
                    {f.subject_contains ? `主题含「${f.subject_contains}」` : null}
                    {!f.enabled ? " · 已停用" : null}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => handleToggleInbox(f)}
                  >
                    {f.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => handleDeleteInbox(f.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── URL monitors ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-fg-primary">网页变化监控</h3>
          <Button
            size="sm"
            variant="subtle"
            disabled={busy || urlMonitors.length === 0}
            onClick={handleCheckNow}
          >
            立即检查
          </Button>
        </div>
        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
          <Input
            placeholder="名称（如：发布说明）"
            value={urlName}
            onChange={(e) => setUrlName(e.target.value)}
          />
          <Input
            placeholder="https://…"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
          />
          <Input
            placeholder="检查间隔（分钟，最少 30）"
            value={urlInterval}
            onChange={(e) => setUrlInterval(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !urlName.trim() || !urlValue.trim()}
            onClick={handleCreateUrl}
          >
            添加网页监控
          </Button>
        </div>
        {checkHint ? <p className="text-xs text-fg-tertiary">{checkHint}</p> : null}

        {urlMonitors.length === 0 ? (
          <EmptyState
            icon={<Radar className="w-8 h-8" />}
            title="暂无网页监控"
            description="添加一个 URL，正文有实质变化时再通知你（首次抓取只建基线）。"
          />
        ) : (
          <ul className="space-y-2">
            {urlMonitors.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm text-fg-primary font-medium truncate">{m.name}</div>
                  <div className="text-xs text-fg-tertiary mt-0.5 truncate">{m.url}</div>
                  <div className="text-xs text-fg-tertiary mt-0.5">
                    每 {m.check_interval_minutes} 分钟
                    {m.last_checked_at ? ` · 上次 ${timeAgo(m.last_checked_at)}` : " · 尚未检查"}
                    {m.last_hash ? " · 已建基线" : null}
                    {!m.enabled ? " · 已停用" : null}
                    {m.last_error ? ` · 错误：${m.last_error}` : null}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => handleToggleUrl(m)}
                  >
                    {m.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => handleDeleteUrl(m.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
