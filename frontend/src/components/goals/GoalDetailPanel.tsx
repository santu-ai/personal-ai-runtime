import { useState } from "react";
import { type WorkItem } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useInvalidateGoals } from "../../hooks/useGoalsQuery";
import { createGoalAction, updateGoalAction, decomposeGoal, ApiError } from "../../api/client";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { isStagnant } from "../../utils/timeUtils";
import { Sparkles } from "lucide-react";

const statusLabels: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
};

interface GoalDetailPanelProps {
  goal: WorkItem;
  onStartChat: (goal: WorkItem) => void;
  onUpdateStatus: (goalId: string, status: string) => void;
  onRequestDelete: (goal: WorkItem) => void;
  onCreatedAction: () => void;
}

export default function GoalDetailPanel({
  goal,
  onStartChat,
  onUpdateStatus,
  onRequestDelete,
  onCreatedAction,
}: GoalDetailPanelProps) {
  const [suggestedSteps, setSuggestedSteps] = useState<string[]>([]);
  const [decomposing, setDecomposing] = useState(false);
  const addError = useErrorStore((s) => s.addError);
  const invalidateGoals = useInvalidateGoals();

  const handleCreateAction = async (goalId: string, title: string) => {
    if (!title.trim()) return;
    try {
      await createGoalAction(goalId, title);
      invalidateGoals();
      onCreatedAction();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建行动步骤失败";
      addError(msg, "目标");
    }
  };

  const handleToggleAction = async (goalId: string, actionId: string, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      await updateGoalAction(goalId, actionId, { status: newStatus });
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "更新行动步骤失败";
      addError(msg, "目标");
    }
  };

  const handleDecomposeGoal = async () => {
    setDecomposing(true);
    setSuggestedSteps([]);
    try {
      const result = await decomposeGoal(goal.id);
      setSuggestedSteps(result.steps || []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "AI 拆解失败";
      addError(msg, "目标");
    } finally {
      setDecomposing(false);
    }
  };

  const handleAddSuggestedStep = async (title: string) => {
    await handleCreateAction(goal.id, title);
    setSuggestedSteps((prev) => prev.filter((s) => s !== title));
  };

  const handleAddAllSuggestedSteps = async () => {
    for (const step of suggestedSteps) {
      await handleCreateAction(goal.id, step);
    }
    setSuggestedSteps([]);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-fg-primary">{goal.title}</h2>
          <div className="flex items-center gap-2 mt-2">
            <Badge
              tone={goal.status === "active" || goal.status === "completed" ? "success" : "default"}
            >
              {statusLabels[goal.status] || goal.status}
            </Badge>
            {isStagnant(goal.last_activity_at, goal.created_at) && goal.status === "active" && (
              <Badge tone="warning">已停滞</Badge>
            )}
          </div>
          <div className="mt-3 h-2 bg-surface-overlay rounded-full overflow-hidden max-w-xs">
            <div
              className="h-full bg-insight rounded-full transition-all"
              style={{ width: `${Math.min(goal.progress, 100)}%` }}
            />
          </div>
          <p className="text-xs text-fg-tertiary mt-1">进度 {goal.progress}%</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onStartChat(goal)}>
            就此目标对话
          </Button>
          {goal.status === "active" && (
            <>
              <button
                onClick={() => onUpdateStatus(goal.id, "paused")}
                className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                暂停
              </button>
              <button
                onClick={() => onUpdateStatus(goal.id, "completed")}
                className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                完成
              </button>
            </>
          )}
          {goal.status === "paused" && (
            <button
              onClick={() => onUpdateStatus(goal.id, "active")}
              className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              恢复
            </button>
          )}
          <Button size="sm" variant="danger" onClick={() => onRequestDelete(goal)}>
            删除
          </Button>
        </div>
      </div>

      {goal.description && <p className="text-fg-secondary mb-6">{goal.description}</p>}

      {/* Actions */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg-secondary">
            行动步骤 ({goal.actions?.length || 0})
          </h3>
          <button
            onClick={handleDecomposeGoal}
            disabled={decomposing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-insight/15 hover:bg-insight/25 text-insight rounded-lg border border-insight/30 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <Sparkles size={12} />
            {decomposing ? "AI 拆解中..." : "AI 拆解"}
          </button>
        </div>

        {/* AI Suggested Steps */}
        {suggestedSteps.length > 0 && (
          <div className="mb-4 p-3 bg-insight/10 border border-insight/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-insight font-medium inline-flex items-center gap-1">
                <Sparkles size={12} />
                AI 建议的行动步骤
              </span>
              <button
                onClick={handleAddAllSuggestedSteps}
                className="text-xs px-2 py-1 bg-insight/30 hover:bg-insight/40 rounded text-insight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                全部添加
              </button>
            </div>
            <div className="space-y-1.5">
              {suggestedSteps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-fg-primary">
                  <span className="text-insight">•</span>
                  <span className="flex-1">{step}</span>
                  <button
                    onClick={() => handleAddSuggestedStep(step)}
                    className="text-xs px-2 py-0.5 bg-surface-overlay hover:bg-border-strong rounded text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {(goal.actions || []).map((action) => (
            <div
              key={action.id}
              className="flex items-center gap-3 p-3 bg-surface-overlay/50 rounded-lg"
            >
              <input
                type="checkbox"
                checked={action.status === "completed"}
                onChange={() => handleToggleAction(goal.id, action.id, action.status)}
                className="w-4 h-4 rounded border-border-strong bg-surface-overlay accent-success"
              />
              <span
                className={`text-sm flex-1 ${action.status === "completed" ? "line-through text-fg-tertiary" : "text-fg-primary"}`}
              >
                {action.title}
              </span>
            </div>
          ))}
          <NewActionInput onAdd={(title) => handleCreateAction(goal.id, title)} />
        </div>
      </div>

      {/* Events */}
      {goal.events && goal.events.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-fg-secondary mb-3">相关事件</h3>
          <div className="space-y-2">
            {goal.events.map((event) => (
              <div key={event.id} className="flex items-center gap-2 text-xs text-fg-tertiary">
                <span className="text-fg-disabled">
                  {new Date(event.timestamp).toLocaleString("zh-CN")}
                </span>
                <span>{event.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewActionInput({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue("");
    }
  };

  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="添加行动步骤..."
        className="flex-1 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
      />
      <button
        onClick={handleSubmit}
        disabled={!value.trim()}
        className="px-3 py-2 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        添加
      </button>
    </div>
  );
}
