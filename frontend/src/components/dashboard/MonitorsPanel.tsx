import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/core";
import {
  createInboxFilter,
  deleteInboxFilter,
  listInboxFilters,
  updateInboxFilter,
  type InboxFilter,
} from "../../api/monitors";
import { useErrorStore } from "../../stores/errorStore";
import Button from "../ui/Button";
import { Input } from "../ui/Input";
import EmptyState from "../ui/EmptyState";
import { Radar } from "lucide-react";

export default function MonitorsPanel() {
  const addError = useErrorStore((s) => s.addError);
  const [filters, setFilters] = useState<InboxFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFilters(await listInboxFilters());
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "加载监控规则失败", "监控");
    } finally {
      setLoading(false);
    }
  }, [addError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
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

  const handleToggle = async (f: InboxFilter) => {
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

  const handleDelete = async (id: string) => {
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

  if (loading) {
    return <p className="text-sm text-fg-tertiary py-8 text-center">加载中…</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-fg-secondary">
        收件箱过滤器会在每次邮件拉取后求值：发件人或主题匹配时通知一次，同一封邮件同一规则不会重复提醒。
      </p>

      <section className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
        <h3 className="text-sm font-medium text-fg-primary">新建过滤器</h3>
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
          onClick={handleCreate}
        >
          添加
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">已有规则</h3>
        {filters.length === 0 ? (
          <EmptyState
            icon={<Radar className="w-8 h-8" />}
            title="暂无监控规则"
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
                  <Button size="sm" variant="subtle" disabled={busy} onClick={() => handleToggle(f)}>
                    {f.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={busy}
                    onClick={() => handleDelete(f.id)}
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
