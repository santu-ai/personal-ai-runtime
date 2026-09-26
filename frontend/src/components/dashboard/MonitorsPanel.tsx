import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
import Dialog from "../ui/Dialog";
import { Input } from "../ui/Input";
import EmptyState from "../ui/EmptyState";
import LoadErrorNotice, { queryErrorMessage } from "../ui/LoadErrorNotice";
import { Radar } from "lucide-react";
import { isImeKeyboardEvent } from "../../utils/imeKey";
import { timeAgo } from "../../utils/timeUtils";

/** 平时一行。键盘落到这一行的按钮时写出整句。鼠标悬停仍是一行。 */
const revealOnRowFocus =
  "truncate group-has-[:focus-visible]:overflow-visible group-has-[:focus-visible]:whitespace-normal group-has-[:focus-visible]:text-clip group-has-[:focus-visible]:break-words";

type MonitorHandoff =
  | { kind: "create-inbox"; id: string; token: string }
  | { kind: "create-url"; id: string; token: string }
  | { kind: "delete-inbox"; nextId: string | null; token: string }
  | { kind: "delete-url"; nextId: string | null; token: string };

/** 组字或输入法处理键时的 Enter 交给输入法。还没填够，或这次写还没回来，添加函数自己会停住。 */
function submitOnEnter(submit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isImeKeyboardEvent(event.nativeEvent)) return;
    event.preventDefault();
    submit();
  };
}

/** 焦点在页面空白处、已经卸下的控件上，或还停在这次操作的按钮上，才可以把焦点挪走。 */
function focusIsIdle(token: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  if (active instanceof HTMLButtonElement) {
    if (active.disabled) return true;
    if (active.getAttribute("data-monitor-token") === token) return true;
  }
  return false;
}

function focusByAction(action: string, id: string): boolean {
  const node = document.querySelector<HTMLButtonElement>(
    `button[data-monitor-action="${action}"][data-monitor-id="${CSS.escape(id)}"]`,
  );
  if (!node || node.disabled) return false;
  node.focus();
  return document.activeElement === node;
}

function focusAnchor(anchor: "inbox-name" | "url-name"): boolean {
  const node = document.querySelector<HTMLElement>(`[data-monitor-anchor="${anchor}"]`);
  if (!node || node.hasAttribute("disabled")) return false;
  node.focus();
  return document.activeElement === node;
}

function placeMonitorFocus(handoff: MonitorHandoff): void {
  if (handoff.kind === "create-inbox") {
    if (focusByAction("toggle-inbox", handoff.id)) return;
    focusAnchor("inbox-name");
    return;
  }
  if (handoff.kind === "create-url") {
    if (focusByAction("toggle-url", handoff.id)) return;
    focusAnchor("url-name");
    return;
  }
  if (handoff.kind === "delete-inbox") {
    if (handoff.nextId && focusByAction("delete-inbox", handoff.nextId)) return;
    focusAnchor("inbox-name");
    return;
  }
  if (handoff.nextId && focusByAction("delete-url", handoff.nextId)) return;
  focusAnchor("url-name");
}

function neighborId(rows: readonly { id: string }[], id: string): string | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}

type PendingDelete =
  { kind: "inbox"; id: string; name: string } | { kind: "url"; id: string; name: string };

export default function MonitorsPanel() {
  const addError = useErrorStore((s) => s.addError);
  const [filters, setFilters] = useState<InboxFilter[]>([]);
  const [urlMonitors, setUrlMonitors] = useState<UrlMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const actionLock = useRef(false);
  const focusAfter = useRef<MonitorHandoff | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");

  const [urlName, setUrlName] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlInterval, setUrlInterval] = useState("60");
  const [checkHint, setCheckHint] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PendingDelete | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [inbox, urls] = await Promise.all([listInboxFilters(), listUrlMonitors()]);
      setFilters(inbox);
      setUrlMonitors(urls);
      loadedRef.current = true;
      setLoaded(true);
      setLoadError(null);
      return true;
    } catch (err) {
      const msg = queryErrorMessage(err, "加载监控规则失败");
      if (!loadedRef.current) setLoadError(msg);
      addError(msg, "监控");
      return false;
    } finally {
      setLoading(false);
    }
  }, [addError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 清空草稿会禁用添加按钮。放到绘制前，观察 DOM 的那一轮才不会停在已经禁用的按钮上。
  useLayoutEffect(() => {
    const pending = focusAfter.current;
    if (!pending || actionBusy) return;
    if (
      (pending.kind === "create-inbox" && !filters.some((row) => row.id === pending.id)) ||
      (pending.kind === "create-url" && !urlMonitors.some((row) => row.id === pending.id))
    ) {
      if (loading) return;
    }
    focusAfter.current = null;
    if (!focusIsIdle(pending.token)) return;
    placeMonitorFocus(pending);
  }, [actionBusy, filters, urlMonitors, loading]);

  const start = (token: string) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    focusAfter.current = null;
    setActionBusy(token);
    return true;
  };

  const finish = (next: MonitorHandoff | null) => {
    focusAfter.current = next;
    actionLock.current = false;
    setActionBusy(null);
  };

  const handleCreateInbox = async () => {
    const payload = {
      name: name.trim(),
      sender_contains: sender.trim(),
      subject_contains: subject.trim(),
    };
    if (!payload.name || (!payload.sender_contains && !payload.subject_contains)) return;
    if (!start("create-inbox")) return;
    let handoff: MonitorHandoff | null = null;
    try {
      const created = await createInboxFilter(payload);
      await refresh();
      setName((current) => (current.trim() === payload.name ? "" : current));
      setSender((current) => (current.trim() === payload.sender_contains ? "" : current));
      setSubject((current) => (current.trim() === payload.subject_contains ? "" : current));
      handoff = { kind: "create-inbox", id: created.id, token: "create-inbox" };
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建失败", "监控");
    } finally {
      finish(handoff);
    }
  };

  const handleToggleInbox = async (row: InboxFilter) => {
    const token = `toggle-inbox:${row.id}`;
    if (!start(token)) return;
    try {
      await updateInboxFilter(row.id, { enabled: !row.enabled });
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新失败", "监控");
    } finally {
      finish(null);
    }
  };

  const requestDelete = (target: PendingDelete) => {
    if (actionLock.current || deleteTarget) return;
    setDeleteTarget(target);
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target || actionLock.current) return;
    const token = target.kind === "inbox" ? `delete-inbox:${target.id}` : `delete-url:${target.id}`;
    if (!start(token)) return;
    const nextId = neighborId(target.kind === "inbox" ? filters : urlMonitors, target.id);
    let handoff: MonitorHandoff | null = null;
    try {
      if (target.kind === "inbox") await deleteInboxFilter(target.id);
      else await deleteUrlMonitor(target.id);
      const listed = await refresh();
      if (listed) {
        handoff =
          target.kind === "inbox"
            ? { kind: "delete-inbox", nextId, token }
            : { kind: "delete-url", nextId, token };
      }
      setDeleteTarget(null);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除失败", "监控");
    } finally {
      finish(handoff);
    }
  };

  const handleCreateUrl = async () => {
    const urlNameValue = urlName.trim();
    const urlText = urlValue.trim();
    if (!urlNameValue || !urlText) return;
    const intervalText = urlInterval;
    const interval = Number(intervalText) || 60;
    if (!start("create-url")) return;
    let handoff: MonitorHandoff | null = null;
    try {
      const created = await createUrlMonitor({
        name: urlNameValue,
        url: urlText,
        check_interval_minutes: interval,
      });
      await refresh();
      setUrlName((current) => (current.trim() === urlNameValue ? "" : current));
      setUrlValue((current) => (current.trim() === urlText ? "" : current));
      setUrlInterval((current) => (current === intervalText ? "60" : current));
      handoff = { kind: "create-url", id: created.id, token: "create-url" };
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建失败", "监控");
    } finally {
      finish(handoff);
    }
  };

  const handleToggleUrl = async (row: UrlMonitor) => {
    const token = `toggle-url:${row.id}`;
    if (!start(token)) return;
    try {
      await updateUrlMonitor(row.id, { enabled: !row.enabled });
      await refresh();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新失败", "监控");
    } finally {
      finish(null);
    }
  };

  const handleCheckNow = async () => {
    if (urlMonitors.length === 0) return;
    if (!start("check")) return;
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
      finish(null);
    }
  };

  const busyClass = (token: string) => (actionBusy === token ? "opacity-50" : "");

  if (!loaded && loadError) {
    return (
      <LoadErrorNotice
        message={loadError}
        busy={loading}
        onRetry={() => void refresh()}
        testId="monitors-load-error"
      />
    );
  }

  if (loading && !loaded) {
    return <p className="text-sm text-fg-tertiary py-8 text-center">加载中…</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-fg-secondary">
        收件箱过滤器在每次邮件拉取后求值；网页监控按间隔抓取正文，内容变化时才通知一次。
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-fg-primary">收件箱过滤器</h3>
        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
          <Input
            placeholder="名称（如：老板）"
            value={name}
            data-monitor-anchor="inbox-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateInbox())}
          />
          <Input
            placeholder="发件人包含（可空）"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateInbox())}
          />
          <Input
            placeholder="主题包含（可空）"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateInbox())}
          />
          <Button
            size="sm"
            disabled={!name.trim() || (!sender.trim() && !subject.trim())}
            aria-busy={actionBusy === "create-inbox" || undefined}
            className={busyClass("create-inbox")}
            data-monitor-token="create-inbox"
            onClick={() => void handleCreateInbox()}
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
            {filters.map((row) => (
              <li
                key={row.id}
                className="group flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <div className={`text-sm font-medium text-fg-primary ${revealOnRowFocus}`}>
                    {row.name}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">
                    {row.sender_contains ? `发件人含「${row.sender_contains}」` : null}
                    {row.sender_contains && row.subject_contains ? " · " : null}
                    {row.subject_contains ? `主题含「${row.subject_contains}」` : null}
                    {!row.enabled ? " · 已停用" : null}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="subtle"
                    aria-busy={actionBusy === `toggle-inbox:${row.id}` || undefined}
                    className={busyClass(`toggle-inbox:${row.id}`)}
                    data-monitor-token={`toggle-inbox:${row.id}`}
                    data-monitor-action="toggle-inbox"
                    data-monitor-id={row.id}
                    onClick={() => void handleToggleInbox(row)}
                  >
                    {row.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    data-monitor-token={`delete-inbox:${row.id}`}
                    data-monitor-action="delete-inbox"
                    data-monitor-id={row.id}
                    onClick={() => requestDelete({ kind: "inbox", id: row.id, name: row.name })}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-fg-primary">网页变化监控</h3>
          <Button
            size="sm"
            variant="subtle"
            disabled={urlMonitors.length === 0}
            aria-busy={actionBusy === "check" || undefined}
            className={busyClass("check")}
            data-monitor-token="check"
            onClick={() => void handleCheckNow()}
          >
            立即检查
          </Button>
        </div>
        <div className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-4">
          <Input
            placeholder="名称（如：发布说明）"
            value={urlName}
            data-monitor-anchor="url-name"
            onChange={(e) => setUrlName(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateUrl())}
          />
          <Input
            placeholder="https://…"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateUrl())}
          />
          <Input
            placeholder="检查间隔（分钟，最少 30）"
            value={urlInterval}
            onChange={(e) => setUrlInterval(e.target.value)}
            onKeyDown={submitOnEnter(() => void handleCreateUrl())}
          />
          <Button
            size="sm"
            disabled={!urlName.trim() || !urlValue.trim()}
            aria-busy={actionBusy === "create-url" || undefined}
            className={busyClass("create-url")}
            data-monitor-token="create-url"
            onClick={() => void handleCreateUrl()}
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
            {urlMonitors.map((row) => (
              <li
                key={row.id}
                className="group flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <div className={`text-sm font-medium text-fg-primary ${revealOnRowFocus}`}>
                    {row.name}
                  </div>
                  <div className={`mt-0.5 text-xs text-fg-tertiary ${revealOnRowFocus}`}>
                    {row.url}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">
                    每 {row.check_interval_minutes} 分钟
                    {row.last_checked_at
                      ? ` · 上次 ${timeAgo(row.last_checked_at)}`
                      : " · 尚未检查"}
                    {row.last_hash ? " · 已建基线" : null}
                    {!row.enabled ? " · 已停用" : null}
                    {row.last_error ? ` · 错误：${row.last_error}` : null}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="subtle"
                    aria-busy={actionBusy === `toggle-url:${row.id}` || undefined}
                    className={busyClass(`toggle-url:${row.id}`)}
                    data-monitor-token={`toggle-url:${row.id}`}
                    data-monitor-action="toggle-url"
                    data-monitor-id={row.id}
                    onClick={() => void handleToggleUrl(row)}
                  >
                    {row.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    data-monitor-token={`delete-url:${row.id}`}
                    data-monitor-action="delete-url"
                    data-monitor-id={row.id}
                    onClick={() => requestDelete({ kind: "url", id: row.id, name: row.name })}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "url" ? "删除网页监控" : "删除收件箱过滤器"}
        description={
          deleteTarget
            ? `确定删除${deleteTarget.kind === "url" ? "网页监控" : "收件箱过滤器"}「${deleteTarget.name}」？此操作不可撤销。`
            : undefined
        }
        confirmLabel={deleteTarget && actionBusy ? "删除中..." : "删除"}
        variant="danger"
        confirmBusy={Boolean(deleteTarget && actionBusy)}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (actionLock.current) return;
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
