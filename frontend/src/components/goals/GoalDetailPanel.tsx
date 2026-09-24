import { useEffect, useRef, useState } from "react";
import { type WorkItem } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useInvalidateGoals } from "../../hooks/useGoalsQuery";
import { createGoalAction, updateGoalAction, decomposeGoal, ApiError } from "../../api/client";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { goalProgressPercent } from "../../utils/goalProgress";
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
  const goalIdRef = useRef(goal.id);
  const pendingStepsRef = useRef(new Set<string>());
  const addingAllRef = useRef(false);
  goalIdRef.current = goal.id;

  const handleCreateAction = async (goalId: string, title: string): Promise<boolean> => {
    if (!title.trim()) return false;
    try {
      await createGoalAction(goalId, title);
      invalidateGoals();
      onCreatedAction();
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "创建行动步骤失败";
      addError(msg, "目标");
      return false;
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

  useEffect(() => {
    pendingStepsRef.current.clear();
    addingAllRef.current = false;
    setSuggestedSteps([]);
    setDecomposing(false);
  }, [goal.id]);

  const handleDecomposeGoal = async () => {
    const goalId = goal.id;
    setDecomposing(true);
    setSuggestedSteps([]);
    try {
      const result = await decomposeGoal(goalId);
      if (goalIdRef.current !== goalId) return;
      setSuggestedSteps(result.steps || []);
    } catch (err) {
      if (goalIdRef.current !== goalId) return;
      const msg = err instanceof ApiError ? err.message : "AI 拆解失败";
      addError(msg, "目标");
    } finally {
      if (goalIdRef.current === goalId) setDecomposing(false);
    }
  };

  const handleAddSuggestedStep = async (title: string) => {
    if (pendingStepsRef.current.has(title)) return;
    pendingStepsRef.current.add(title);
    const goalId = goal.id;
    try {
      const ok = await handleCreateAction(goalId, title);
      if (!ok || goalIdRef.current !== goalId) return;
      setSuggestedSteps((prev) => prev.filter((s) => s !== title));
    } finally {
      if (goalIdRef.current === goalId) pendingStepsRef.current.delete(title);
    }
  };

  const handleAddAllSuggestedSteps = async () => {
    if (addingAllRef.current) return;
    addingAllRef.current = true;
    const goalId = goal.id;
    try {
      for (const step of [...suggestedSteps]) {
        if (goalIdRef.current !== goalId) return;
        const ok = await handleCreateAction(goalId, step);
        if (goalIdRef.current !== goalId) return;
        if (ok) setSuggestedSteps((prev) => prev.filter((s) => s !== step));
      }
    } finally {
      if (goalIdRef.current === goalId) addingAllRef.current = false;
    }
  };

  const progressPct = Math.round(goalProgressPercent(goal.progress));

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-fg-primary">{goal.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              tone={goal.status === "active" || goal.status === "completed" ? "success" : "default"}
            >
              {statusLabels[goal.status] || goal.status}
            </Badge>
            {isStagnant(goal.last_activity_at, goal.created_at) && goal.status === "active" && (
              <Badge tone="warning">已停滞</Badge>
            )}
          </div>
          <div className="mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-surface-overlay">
            <div
              className="h-full rounded-full bg-insight transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-fg-tertiary">进度 {progressPct}%</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <NewActionInput goalId={goal.id} onAdd={(title) => handleCreateAction(goal.id, title)} />
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

function NewActionInput({
  goalId,
  onAdd,
}: {
  goalId: string;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const goalIdRef = useRef(goalId);

  useEffect(() => {
    goalIdRef.current = goalId;
    savingRef.current = false;
    setSaving(false);
    setValue("");
  }, [goalId]);

  const handleSubmit = async () => {
    const title = value.trim();
    if (!title || savingRef.current) return;
    const submittedFor = goalId;
    savingRef.current = true;
    setSaving(true);
    let ok = false;
    try {
      ok = await onAdd(title);
    } finally {
      if (goalIdRef.current === submittedFor) {
        savingRef.current = false;
        setSaving(false);
        if (ok) setValue("");
      }
    }
  };

  return (
    <div className="flex gap-2">
      <input
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void handleSubmit();
        }}
        placeholder="添加行动步骤..."
        className="flex-1 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={saving || !value.trim()}
        className="px-3 py-2 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {saving ? "添加中..." : "添加"}
      </button>
    </div>
  );
}
