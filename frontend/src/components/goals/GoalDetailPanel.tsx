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
  onUpdateStatus: (goalId: string, status: string) => void | Promise<boolean | void>;
  onRequestDelete: (goal: WorkItem) => void;
  onCreatedAction: () => void;
}

const statusButtonClass =
  "px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

/** 焦点在页面空白处，或还停在已经卸掉的按钮上，才安放。已经在别的控件上就不再抢。 */
function focusIsIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function focusGoalControl(selector: string): void {
  const node = document.querySelector<HTMLElement>(selector);
  node?.focus();
}

/** 状态写成功后，原来的按钮会卸掉。焦点还在原处或空白处时，落到还在的下一处。 */
function placeGoalStatusFocus(status: string): void {
  if (status === "paused") {
    focusGoalControl('button[data-goal-status="active"]');
    return;
  }
  if (status === "active") {
    focusGoalControl('button[data-goal-status="paused"]');
    return;
  }
  if (status === "completed") {
    focusGoalControl("[data-goal-chat]");
  }
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
  const statusLock = useRef(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const actionLocks = useRef(new Set<string>());
  const [busyActions, setBusyActions] = useState<ReadonlySet<string>>(() => new Set());
  const decomposeLock = useRef(false);
  const focusAfter = useRef<{ goalId: string; from: string } | null>(null);
  const seenGoalId = useRef<string | null>(null);
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
    if (actionLocks.current.has(actionId)) return;
    actionLocks.current.add(actionId);
    setBusyActions(new Set(actionLocks.current));
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      await updateGoalAction(goalId, actionId, { status: newStatus });
      invalidateGoals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "更新行动步骤失败";
      addError(msg, "目标");
    } finally {
      if (goalIdRef.current === goalId) {
        actionLocks.current.delete(actionId);
        setBusyActions(new Set(actionLocks.current));
      }
    }
  };

  const requestStatus = (status: string) => {
    if (statusLock.current) return;
    const goalId = goal.id;
    statusLock.current = true;
    setStatusBusy(status);
    focusAfter.current = { goalId, from: goal.status };
    void (async () => {
      let ok = false;
      try {
        const result = await onUpdateStatus(goalId, status);
        ok = result !== false;
      } catch {
        ok = false;
      } finally {
        if (goalIdRef.current === goalId) {
          statusLock.current = false;
          setStatusBusy(null);
          if (!ok) focusAfter.current = null;
        }
      }
    })();
  };

  useEffect(() => {
    if (seenGoalId.current === null) {
      seenGoalId.current = goal.id;
      return;
    }
    if (seenGoalId.current === goal.id) return;
    seenGoalId.current = goal.id;
    pendingStepsRef.current.clear();
    addingAllRef.current = false;
    statusLock.current = false;
    actionLocks.current.clear();
    decomposeLock.current = false;
    focusAfter.current = null;
    setSuggestedSteps([]);
    setDecomposing(false);
    setStatusBusy(null);
    setBusyActions(new Set());
  }, [goal.id]);

  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || statusBusy) return;
    if (pending.goalId !== goal.id) {
      focusAfter.current = null;
      return;
    }
    if (goal.status === pending.from) return;
    focusAfter.current = null;
    if (!focusIsIdle()) return;
    placeGoalStatusFocus(goal.status);
  }, [goal.id, goal.status, statusBusy]);

  const handleDecomposeGoal = async () => {
    if (decomposeLock.current) return;
    const goalId = goal.id;
    decomposeLock.current = true;
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
      if (goalIdRef.current === goalId) {
        decomposeLock.current = false;
        setDecomposing(false);
      }
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
          <Button size="sm" data-goal-chat="" onClick={() => onStartChat(goal)}>
            就此目标对话
          </Button>
          {goal.status === "active" && (
            <>
              <button
                type="button"
                data-goal-status="paused"
                aria-busy={statusBusy === "paused" || undefined}
                onClick={() => requestStatus("paused")}
                className={`${statusButtonClass} ${statusBusy ? "opacity-50" : ""}`}
              >
                暂停
              </button>
              <button
                type="button"
                data-goal-status="completed"
                aria-busy={statusBusy === "completed" || undefined}
                onClick={() => requestStatus("completed")}
                className={`${statusButtonClass} ${statusBusy ? "opacity-50" : ""}`}
              >
                完成
              </button>
            </>
          )}
          {goal.status === "paused" && (
            <button
              type="button"
              data-goal-status="active"
              aria-busy={statusBusy === "active" || undefined}
              onClick={() => requestStatus("active")}
              className={`${statusButtonClass} ${statusBusy ? "opacity-50" : ""}`}
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
            type="button"
            onClick={() => void handleDecomposeGoal()}
            aria-busy={decomposing || undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs bg-insight/15 hover:bg-insight/25 text-insight rounded-lg border border-insight/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              decomposing ? "opacity-50" : ""
            }`}
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
                aria-label={action.title || "行动步骤"}
                aria-busy={busyActions.has(action.id) || undefined}
                onChange={() => void handleToggleAction(goal.id, action.id, action.status)}
                className={`w-4 h-4 rounded border-border-strong bg-surface-overlay accent-success ${
                  busyActions.has(action.id) ? "opacity-50" : ""
                }`}
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

function actionFieldSelector(goalId: string): string {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(goalId)
      : goalId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `input[data-goal-anchor="action"][data-goal-id="${escaped}"]`;
}

/** 焦点在页面空白处，或还停在这次添加的输入框或「添加」上。 */
function actionFocusIdle(goalId: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  if (active.getAttribute("data-goal-id") !== goalId) return false;
  const anchor = active.getAttribute("data-goal-anchor");
  return anchor === "action" || anchor === "action-add";
}

function actionFocusLost(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function focusActionField(goalId: string): boolean {
  const input = document.querySelector<HTMLInputElement>(actionFieldSelector(goalId));
  if (!input || input.disabled) return false;
  if (document.activeElement !== input) input.focus();
  return document.activeElement === input;
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
  const valueRef = useRef("");
  const handoff = useRef<null | "success" | "failed">(null);

  useEffect(() => {
    goalIdRef.current = goalId;
    savingRef.current = false;
    handoff.current = null;
    valueRef.current = "";
    setSaving(false);
    setValue("");
  }, [goalId]);

  useEffect(() => {
    if (saving) return;
    const pending = handoff.current;
    if (!pending) return;
    handoff.current = null;
    const currentGoal = goalIdRef.current;
    if (pending === "failed") {
      if (actionFocusLost()) focusActionField(currentGoal);
      return;
    }
    if (!actionFocusIdle(currentGoal)) return;
    focusActionField(currentGoal);
  }, [saving]);

  const handleSubmit = async () => {
    const title = value.trim();
    if (!title || savingRef.current) return;
    const submitted = value;
    const submittedFor = goalId;
    savingRef.current = true;
    handoff.current = null;
    setSaving(true);
    let ok = false;
    try {
      ok = await onAdd(title);
    } finally {
      if (goalIdRef.current === submittedFor) {
        savingRef.current = false;
        if (ok && valueRef.current === submitted) {
          valueRef.current = "";
          setValue("");
        }
        handoff.current = ok ? "success" : "failed";
        setSaving(false);
      }
    }
  };

  return (
    <div className="flex gap-2">
      <input
        value={value}
        data-goal-anchor="action"
        data-goal-id={goalId}
        onChange={(e) => {
          valueRef.current = e.target.value;
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void handleSubmit();
        }}
        placeholder="添加行动步骤..."
        className="flex-1 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
      />
      <button
        type="button"
        data-goal-anchor="action-add"
        data-goal-id={goalId}
        onClick={() => void handleSubmit()}
        disabled={!value.trim()}
        aria-busy={saving || undefined}
        className={`px-3 py-2 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${saving ? " opacity-50" : ""}`}
      >
        {saving ? "添加中..." : "添加"}
      </button>
    </div>
  );
}
