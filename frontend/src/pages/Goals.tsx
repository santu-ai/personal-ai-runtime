import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createGoal, updateGoal, deleteGoal, ApiError, type Goal } from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useQuickChat } from "../hooks/useQuickChat";
import { useGoalsQuery, useGoalQuery, useInvalidateGoals } from "../hooks/useGoalsQuery";
import Button from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import EmptyState from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { timeAgo, isStagnant } from "../utils/timeUtils";
import GoalDetailPanel from "../components/goals/GoalDetailPanel";

export default function GoalsPage() {
  const { goalId: urlGoalId } = useParams();
  const navigate = useNavigate();
  const { data: goals = [], error: listError } = useGoalsQuery();
  const {
    data: selectedGoal = null,
    error: detailError,
    isError: detailIsError,
  } = useGoalQuery(urlGoalId);
  const invalidateGoals = useInvalidateGoals();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();

  const goalNotFound =
    Boolean(urlGoalId) &&
    detailIsError &&
    detailError instanceof ApiError &&
    detailError.status === 404;

  useEffect(() => {
    if (listError) {
      const msg = listError instanceof ApiError ? listError.message : "加载目标失败";
      addError(msg, "目标");
    }
  }, [listError, addError]);

  useEffect(() => {
    if (detailError && !(detailError instanceof ApiError && detailError.status === 404)) {
      const msg = detailError instanceof ApiError ? detailError.message : "加载目标详情失败";
      addError(msg, "目标");
    }
  }, [detailError, addError]);

  const handleSelectGoal = (goalId: string) => {
    navigate(`/goals/${goalId}`);
  };

  const handleStartChatAboutGoal = (goal: Goal) => {
    quickChat({
      title: `目标：${goal.title}`,
      prompt: `我想讨论目标「${goal.title}」${goal.description ? `：${goal.description}` : ""}。当前进度 ${goal.progress}%，请帮我分析下一步行动。`,
    });
  };

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      await createGoal({ title: newTitle });
      setNewTitle("");
      setShowCreate(false);
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建目标失败";
      addError(msg, "目标");
    }
    setLoading(false);
  };

  const handleUpdateStatus = async (goalId: string, status: string) => {
    try {
      await updateGoal(goalId, { status });
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "更新目标状态失败";
      addError(msg, "目标");
    }
  };

  const handleDeleteGoal = async () => {
    if (!deleteTarget) return;
    const goalId = deleteTarget.id;
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
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Goal list panel */}
      <div className="w-80 border-r border-border-subtle overflow-y-auto shrink-0">
        <div className="p-4 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg-primary">目标</h2>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + 新建
          </Button>
        </div>

        {showCreate && (
          <div className="p-3 border-b border-border-subtle">
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateGoal()}
              placeholder="目标名称..."
              className="w-full"
            />
            <div className="flex gap-2 mt-2">
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

        <div className="p-2 space-y-1">
          {goals.length === 0 ? (
            <EmptyState
              title="暂无目标"
              description="创建第一个目标，让 AI 帮你追踪进度"
              action={
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  创建目标
                </Button>
              }
            />
          ) : (
            <GoalGroupedList
              goals={goals}
              selectedId={selectedGoal?.id}
              onSelect={handleSelectGoal}
            />
          )}
        </div>
      </div>

      {/* Goal detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {goalNotFound ? (
          <EmptyState
            title="目标不存在"
            description="该目标可能已被删除，或链接无效。请从左侧列表选择其他目标。"
            action={
              <Button size="sm" onClick={() => navigate("/goals")}>
                返回列表
              </Button>
            }
          />
        ) : selectedGoal ? (
          <GoalDetailPanel
            goal={selectedGoal}
            onStartChat={handleStartChatAboutGoal}
            onUpdateStatus={handleUpdateStatus}
            onRequestDelete={(g) => setDeleteTarget(g)}
            onCreatedAction={() => {
              /* 行动步骤创建后列表自动刷新 via invalidateGoals */
            }}
          />
        ) : (
          <EmptyState title="选择一个目标" description="从左侧列表选择目标查看详情与行动步骤" />
        )}
      </div>

      <Dialog
        open={!!deleteTarget}
        title="删除目标"
        description={
          deleteTarget
            ? `确定删除目标「${deleteTarget.title}」？关联的行动步骤将一并删除，此操作不可撤销。`
            : undefined
        }
        confirmLabel={deleting ? "删除中…" : "删除"}
        variant="danger"
        onConfirm={handleDeleteGoal}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}

function GoalGroupedList({
  goals,
  selectedId,
  onSelect,
}: {
  goals: Goal[];
  selectedId?: string;
  onSelect: (goalId: string) => void;
}) {
  const activeOrPaused = goals.filter((g) => g.status !== "completed");
  const completed = goals.filter((g) => g.status === "completed");

  return (
    <>
      {activeOrPaused.map((goal) => (
        <GoalListItem
          key={goal.id}
          goal={goal}
          selected={goal.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {completed.length > 0 && (
        <>
          <div className="pt-3 pb-1 px-1 text-xs text-fg-tertiary font-medium uppercase tracking-wider">
            已完成 ({completed.length})
          </div>
          {completed.map((goal) => (
            <GoalListItem
              key={goal.id}
              goal={goal}
              selected={goal.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </>
  );
}

function GoalListItem({
  goal,
  selected,
  onSelect,
}: {
  goal: Goal;
  selected: boolean;
  onSelect: (goalId: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(goal.id)}
      className={`p-3 rounded-lg cursor-pointer transition-colors ${
        selected
          ? "bg-surface-overlay border border-border-strong"
          : "hover:bg-surface-overlay/50 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
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
        <span className="text-sm font-medium text-fg-primary truncate flex-1">{goal.title}</span>
      </div>
      {goal.last_activity_at && (
        <div className="text-xs text-fg-disabled mt-1 ml-4">
          上次活动: {timeAgo(goal.last_activity_at)}
        </div>
      )}
      {goal.deadline && (
        <div className="text-xs text-fg-tertiary mt-1 ml-4">
          截止: {new Date(goal.deadline).toLocaleDateString("zh-CN")}
        </div>
      )}
      <div className="mt-2 ml-4 h-1 bg-surface-overlay rounded-full overflow-hidden">
        <div
          className="h-full bg-insight rounded-full"
          style={{ width: `${Math.min(goal.progress, 100)}%` }}
        />
      </div>
    </div>
  );
}
