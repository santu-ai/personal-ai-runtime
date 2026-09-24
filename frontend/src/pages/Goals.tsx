import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createGoal, updateGoal, deleteGoal, ApiError, type WorkItem } from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useQuickChat } from "../hooks/useQuickChat";
import { useGoalsQuery, useGoalQuery, useInvalidateGoals } from "../hooks/useGoalsQuery";
import Button from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import EmptyState from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import PageHeader from "../components/ui/PageHeader";
import { goalProgressPercent } from "../utils/goalProgress";
import { timeAgo, isStagnant } from "../utils/timeUtils";
import GoalDetailPanel from "../components/goals/GoalDetailPanel";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app";
const backLinkClass = `inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${focusRing}`;
const backLinkSecondary = `${backLinkClass} border border-border-subtle bg-surface-raised text-fg-primary hover:bg-surface-hover`;
const backLinkPrimary = `${backLinkClass} bg-insight-strong text-fg-on-accent shadow-sm hover:bg-insight`;

function goalPageHref(goalId: string): string {
  return `/goals/${encodeURIComponent(goalId)}`;
}

export default function GoalsPage() {
  const { goalId: urlGoalId } = useParams();
  const navigate = useNavigate();
  const {
    data: goals = [],
    error: listError,
    isLoading: listLoading,
    isFetching: listFetching,
    refetch: refetchGoals,
  } = useGoalsQuery();
  const {
    data: selectedGoal = null,
    error: detailError,
    isError: detailIsError,
    isFetching: detailFetching,
    refetch: refetchGoal,
  } = useGoalQuery(urlGoalId);
  const invalidateGoals = useInvalidateGoals();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const creatingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();

  const goalNotFound =
    Boolean(urlGoalId) &&
    detailIsError &&
    detailError instanceof ApiError &&
    detailError.status === 404;
  const shownListError = useHeldQueryError(
    goals.length > 0,
    listError,
    listFetching,
    "加载目标失败",
    "list",
  );
  const shownDetailError = useHeldQueryError(
    Boolean(selectedGoal) || goalNotFound || !urlGoalId,
    goalNotFound ? null : detailError,
    detailFetching,
    "加载目标详情失败",
    urlGoalId ?? "",
  );

  useEffect(() => {
    if (listError) {
      addError(queryErrorMessage(listError, "加载目标失败"), "目标");
    }
  }, [listError, addError]);

  useEffect(() => {
    if (detailError && !(detailError instanceof ApiError && detailError.status === 404)) {
      addError(queryErrorMessage(detailError, "加载目标详情失败"), "目标");
    }
  }, [detailError, addError]);

  const handleStartChatAboutGoal = (goal: WorkItem) => {
    quickChat({
      title: `目标：${goal.title}`,
      prompt: `我想讨论目标「${goal.title}」${goal.description ? `：${goal.description}` : ""}。当前进度 ${Math.round(goalProgressPercent(goal.progress))}%，请帮我分析下一步行动。`,
    });
  };

  const handleCreateGoal = async () => {
    const title = newTitle.trim();
    if (!title || creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    try {
      await createGoal({ title });
      setNewTitle("");
      setShowCreate(false);
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建目标失败";
      addError(msg, "目标");
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (goalId: string, status: string): Promise<boolean> => {
    try {
      await updateGoal(goalId, { status });
      invalidateGoals();
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "更新目标状态失败";
      addError(msg, "目标");
      return false;
    }
  };

  const handleDeleteGoal = async () => {
    if (!deleteTarget || deletingRef.current) return;
    const goalId = deleteTarget.id;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteGoal(goalId);
      setDeleteTarget(null);
      if (urlGoalId === goalId) {
        navigate("/goals");
      }
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "删除目标失败";
      addError(msg, "目标");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const detailOpen = Boolean(urlGoalId);
  const showSplit = goals.length > 0 || detailOpen;

  return (
    <div className="page-shell">
      <div className="page-container">
        <PageHeader
          title="目标"
          description="追踪进度，拆成下一步行动"
          actions={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + 新建
            </Button>
          }
        />

        {showCreate && (
          <div className="mb-5 rounded-lg border border-border-subtle bg-surface-raised p-4">
            <Input
              autoFocus
              value={newTitle}
              disabled={loading}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void handleCreateGoal();
              }}
              placeholder="目标名称..."
              className="w-full"
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={handleCreateGoal} disabled={loading || !newTitle.trim()}>
                {loading ? "创建中..." : "创建"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowCreate(false);
                  setNewTitle("");
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {!detailOpen && shownListError ? (
          <LoadErrorNotice
            message={shownListError}
            busy={listFetching}
            onRetry={() => void refetchGoals()}
            testId="goals-load-error"
          />
        ) : !detailOpen && listLoading && goals.length === 0 ? (
          <p className="text-sm text-fg-tertiary">加载中…</p>
        ) : showSplit ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <section
              aria-label="目标列表"
              className={detailOpen ? "hidden min-w-0 lg:block" : "min-w-0"}
            >
              {shownListError ? (
                <LoadErrorNotice
                  message={shownListError}
                  busy={listFetching}
                  onRetry={() => void refetchGoals()}
                  testId="goals-load-error"
                  autoFocus={false}
                />
              ) : listLoading && goals.length === 0 ? (
                <p className="text-sm text-fg-tertiary">加载中…</p>
              ) : goals.length === 0 ? (
                <p className="text-sm text-fg-tertiary">暂无其他目标</p>
              ) : (
                <GoalGroupedList goals={goals} selectedId={selectedGoal?.id} />
              )}
            </section>

            <section
              aria-label="目标详情"
              className={detailOpen ? "min-w-0" : "hidden min-w-0 lg:block"}
            >
              {detailOpen && !goalNotFound && (
                <div className="mb-4 lg:hidden">
                  <Link to="/goals" className={backLinkSecondary}>
                    返回列表
                  </Link>
                </div>
              )}
              {shownDetailError ? (
                <LoadErrorNotice
                  message={shownDetailError}
                  busy={detailFetching}
                  onRetry={() => void refetchGoal()}
                  testId="goal-detail-load-error"
                />
              ) : goalNotFound ? (
                <EmptyState
                  title="目标不存在"
                  description="该目标可能已被删除，或链接无效。"
                  action={
                    <Link to="/goals" className={backLinkPrimary}>
                      返回列表
                    </Link>
                  }
                />
              ) : selectedGoal ? (
                <GoalDetailPanel
                  key={selectedGoal.id}
                  goal={selectedGoal}
                  onStartChat={handleStartChatAboutGoal}
                  onUpdateStatus={handleUpdateStatus}
                  onRequestDelete={(g) => setDeleteTarget(g)}
                  onCreatedAction={() => {
                    /* 行动步骤创建后列表自动刷新 via invalidateGoals */
                  }}
                />
              ) : urlGoalId ? (
                <p className="py-14 text-center text-sm text-fg-tertiary">加载中…</p>
              ) : (
                <EmptyState
                  title="选择一个目标"
                  description="从左侧列表选择目标查看详情与行动步骤"
                />
              )}
            </section>
          </div>
        ) : (
          <EmptyState
            title="暂无目标"
            description="创建第一个目标，让 AI 帮你追踪进度"
            action={
              <Button size="sm" onClick={() => setShowCreate(true)}>
                创建目标
              </Button>
            }
          />
        )}

        <Dialog
          open={!!deleteTarget}
          title="删除目标"
          description={
            deleteTarget
              ? `确定删除目标「${deleteTarget.title}」？关联的行动步骤将一并删除，此操作不可撤销。`
              : undefined
          }
          confirmLabel={deleting ? "删除中..." : "删除"}
          variant="danger"
          confirmBusy={deleting}
          onConfirm={() => void handleDeleteGoal()}
          onCancel={() => {
            if (deletingRef.current) return;
            setDeleteTarget(null);
          }}
        />
      </div>
    </div>
  );
}

function GoalGroupedList({ goals, selectedId }: { goals: WorkItem[]; selectedId?: string }) {
  const activeOrPaused = goals.filter((g) => g.status !== "completed");
  const completed = goals.filter((g) => g.status === "completed");

  return (
    <div className="space-y-2">
      {activeOrPaused.map((goal) => (
        <GoalListItem key={goal.id} goal={goal} selected={goal.id === selectedId} />
      ))}
      {completed.length > 0 && (
        <>
          <p className="section-label px-1 pb-1 pt-3">已完成 ({completed.length})</p>
          {completed.map((goal) => (
            <GoalListItem key={goal.id} goal={goal} selected={goal.id === selectedId} />
          ))}
        </>
      )}
    </div>
  );
}

function GoalListItem({ goal, selected }: { goal: WorkItem; selected: boolean }) {
  const progressPct = Math.round(goalProgressPercent(goal.progress));

  return (
    <Link
      to={goalPageHref(goal.id)}
      aria-current={selected ? "page" : undefined}
      className={`block w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
        selected
          ? "border-insight/40 bg-insight/10"
          : "border-border-subtle bg-surface-raised shadow-sm hover:border-border-strong hover:bg-surface-hover/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            goal.status === "active"
              ? "bg-success"
              : goal.status === "completed"
                ? "bg-insight"
                : "bg-fg-tertiary"
          } ${
            isStagnant(goal.last_activity_at, goal.created_at) && goal.status === "active"
              ? "ring-2 ring-warning"
              : ""
          }`}
        />
        <span className="flex-1 truncate text-sm font-medium text-fg-primary">{goal.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-fg-tertiary">{progressPct}%</span>
      </div>
      {goal.last_activity_at && (
        <div className="ml-4 mt-1 text-xs text-fg-disabled">
          上次活动: {timeAgo(goal.last_activity_at)}
        </div>
      )}
      {goal.deadline && (
        <div className="ml-4 mt-1 text-xs text-fg-tertiary">
          截止: {new Date(goal.deadline).toLocaleDateString("zh-CN")}
        </div>
      )}
      <div className="ml-4 mt-2 h-1 overflow-hidden rounded-full bg-surface-overlay">
        <div className="h-full rounded-full bg-insight" style={{ width: `${progressPct}%` }} />
      </div>
    </Link>
  );
}
