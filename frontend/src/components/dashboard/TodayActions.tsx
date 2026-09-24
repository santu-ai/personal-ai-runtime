import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Mail, ShieldCheck, Sparkles, Target } from "lucide-react";
import LoadErrorNotice from "../ui/LoadErrorNotice";
import type { TodayBuckets, TodayDecideItem, TodayDoItem, TodayHandledItem } from "./todayBuckets";

/** 一栏的读取结果。成功的空栏仍用原来的句子；失败且没有条目时不写成空。 */
export interface TodayColumnState {
  error: string | null;
  busy: boolean;
  pending: boolean;
  onRetry: () => void;
}

const idleColumn: TodayColumnState = {
  error: null,
  busy: false,
  pending: false,
  onRetry: () => {},
};

interface TodayActionsProps {
  buckets: TodayBuckets;
  decideStatus?: TodayColumnState;
  doStatus?: TodayColumnState;
  handledStatus?: TodayColumnState;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

function DecideRow({ item }: { item: TodayDecideItem }) {
  const icon =
    item.kind === "approval" ? (
      <ShieldCheck size={14} className="text-warning shrink-0" />
    ) : item.kind === "memory" ? (
      <Sparkles size={14} className="text-insight shrink-0" />
    ) : (
      <Mail size={14} className="text-insight shrink-0" />
    );
  return (
    <Link
      to={item.href}
      className={`w-full flex items-center gap-2 text-xs p-2 bg-warning/5 rounded-lg border border-warning/20 text-left hover:bg-warning/10 ${focusRing}`}
    >
      {icon}
      <span className="text-fg-primary truncate flex-1">{item.title}</span>
    </Link>
  );
}

function DoRow({ item }: { item: TodayDoItem }) {
  return (
    <Link
      to={item.href}
      className={`w-full flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-surface-overlay text-left ${focusRing}`}
    >
      <Target size={14} className="text-warning shrink-0" />
      <span className="text-fg-primary truncate flex-1">{item.title}</span>
      <span className="text-fg-tertiary shrink-0">
        {item.reason === "deadline" ? "截止将近" : "已停滞"}
      </span>
    </Link>
  );
}

function HandledRow({ item }: { item: TodayHandledItem }) {
  return (
    <Link
      to={item.href}
      className={`w-full flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-surface-overlay text-left ${focusRing}`}
    >
      <CheckCircle2 size={14} className="text-success shrink-0" />
      <span className="text-fg-secondary truncate flex-1">{item.title}</span>
    </Link>
  );
}

function ColumnFallback({
  status,
  empty,
  testId,
  autoFocus,
}: {
  status: TodayColumnState;
  empty: ReactNode;
  testId: string;
  autoFocus: boolean;
}) {
  if (status.error) {
    return (
      <LoadErrorNotice
        message={status.error}
        busy={status.busy}
        onRetry={status.onRetry}
        testId={testId}
        autoFocus={autoFocus}
      />
    );
  }
  if (status.pending) {
    return <p className="text-xs text-fg-tertiary">加载中...</p>;
  }
  return empty;
}

export default function TodayActions({
  buckets,
  decideStatus = idleColumn,
  doStatus = idleColumn,
  handledStatus = idleColumn,
}: TodayActionsProps) {
  const { decide, do: doItems, handled, leftoverGoalCount } = buckets;
  const empty = decide.length === 0 && doItems.length === 0 && handled.length === 0;
  const decideBlocked = decide.length === 0 && Boolean(decideStatus.error || decideStatus.pending);
  const doBlocked = doItems.length === 0 && Boolean(doStatus.error || doStatus.pending);
  const handledBlocked =
    handled.length === 0 && Boolean(handledStatus.error || handledStatus.pending);
  const decideFocus = Boolean(decideStatus.error) && decide.length === 0;
  const doFocus = !decideFocus && Boolean(doStatus.error) && doItems.length === 0;
  const handledFocus =
    !decideFocus && !doFocus && Boolean(handledStatus.error) && handled.length === 0;

  if (empty && !decideBlocked && !doBlocked && !handledBlocked) {
    return (
      <div className="mb-5 rounded-lg border border-border-subtle bg-surface-raised p-10 text-center shadow-sm">
        <p className="mb-1 font-medium text-fg-secondary">今天暂无紧急事项</p>
        <p className="text-sm text-fg-tertiary">
          {leftoverGoalCount > 0
            ? `还有 ${leftoverGoalCount} 个进行中目标，可从目标页查看`
            : "去和 AI 聊聊天，或创建第一个目标开始使用"}
        </p>
        {leftoverGoalCount > 0 && (
          <Link
            to="/goals"
            className={`mt-3 inline-block text-xs text-insight hover:text-insight/80 rounded-sm ${focusRing}`}
          >
            查看全部目标 →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
      <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-warning" />
          <h3 className="text-sm font-semibold tracking-tight text-fg-primary">需要你决定</h3>
          <span className="ml-auto text-xs text-fg-tertiary">{decide.length}</span>
        </div>
        {decide.length === 0 ? (
          <ColumnFallback
            status={decideStatus}
            testId="today-decide-load-error"
            autoFocus={decideFocus}
            empty={<p className="text-xs text-fg-disabled">没有待决事项</p>}
          />
        ) : (
          <div className="space-y-1.5">
            {decide.slice(0, 5).map((item) => (
              <DecideRow key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Target size={16} className="text-warning" />
          <h3 className="text-sm font-semibold tracking-tight text-fg-primary">今天要做</h3>
          <span className="ml-auto text-xs text-fg-tertiary">{doItems.length}</span>
        </div>
        {doItems.length === 0 ? (
          <ColumnFallback
            status={doStatus}
            testId="today-do-load-error"
            autoFocus={doFocus}
            empty={
              <p className="text-xs text-fg-disabled">
                {leftoverGoalCount > 0
                  ? `其余 ${leftoverGoalCount} 个目标可稍后看`
                  : "没有时限内目标"}
              </p>
            }
          />
        ) : (
          <div className="space-y-1.5">
            {doItems.slice(0, 5).map((item) => (
              <DoRow key={item.id} item={item} />
            ))}
            {leftoverGoalCount > 0 && (
              <Link
                to="/goals"
                className={`mt-1 inline-block text-xs text-insight hover:text-insight/80 rounded-sm ${focusRing}`}
              >
                还有 {leftoverGoalCount} 个目标 →
              </Link>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-success" />
          <h3 className="text-sm font-semibold tracking-tight text-fg-primary">AI 已处理</h3>
          <span className="ml-auto text-xs text-fg-tertiary">{handled.length}</span>
        </div>
        {handled.length === 0 ? (
          <ColumnFallback
            status={handledStatus}
            testId="today-handled-load-error"
            autoFocus={handledFocus}
            empty={<p className="text-xs text-fg-disabled">今天还没有处理记录</p>}
          />
        ) : (
          <div className="space-y-1.5">
            {handled.slice(0, 5).map((item) => (
              <HandledRow key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
