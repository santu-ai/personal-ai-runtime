import { Link } from "react-router-dom";
import { Clock, RefreshCw } from "lucide-react";
import type { RerunnableBrief, TimerStatusItem } from "../../api/types";

const TIMER_LABELS: Record<string, string> = {
  morning_brief: "早安简报",
  deadline_alert: "截止提醒",
  memory_decay: "记忆衰减",
  world_model_snapshot: "世界模型快照",
  projection_snapshots: "投影快照",
  inbox_poll: "收件箱拉取",
  inbox_digest: "收件箱摘要",
  url_monitor: "网页监控",
  telegram_poll: "Telegram 轮询",
  reminder: "提醒",
};

function timerLabel(name: string): string {
  return TIMER_LABELS[name] || name || "定时任务";
}

function scheduleLabel(scheduleType: string): string {
  if (scheduleType === "cron") return "周期";
  if (scheduleType === "once") return "一次";
  return scheduleType || "定时";
}

function taskPath(workId: string): string {
  return `/tasks/${encodeURIComponent(workId)}`;
}

function TimerRow({ item }: { item: TimerStatusItem }) {
  const text = `${timerLabel(item.handler_name)} · ${scheduleLabel(item.schedule_type)} · ${
    item.fire_at || "时间未定"
  }`;
  const workId = item.work_id?.trim();
  if (!workId) {
    return <span className="min-w-0 truncate text-fg-secondary">{text}</span>;
  }
  return (
    <Link to={taskPath(workId)} className="min-w-0 truncate text-fg-primary hover:underline">
      {text}
    </Link>
  );
}

interface TimerBriefPanelProps {
  timers: TimerStatusItem[];
  activeTimers: number;
  briefs: RerunnableBrief[];
}

export default function TimerBriefPanel({ timers, activeTimers, briefs }: TimerBriefPanelProps) {
  if (timers.length === 0 && briefs.length === 0) return null;
  const extraTimers = Math.max(0, activeTimers - timers.length);

  return (
    <section
      aria-label="定时与再次运行"
      className="mb-5 rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center gap-2">
        <Clock size={16} className="text-fg-tertiary" />
        <h3 className="text-sm font-semibold tracking-tight text-fg-primary">定时</h3>
      </div>
      {timers.length > 0 ? (
        <ul className="space-y-1.5">
          {timers.map((item) => (
            <li key={item.id || `${item.handler_name}:${item.fire_at}`} className="text-xs">
              <TimerRow item={item} />
            </li>
          ))}
        </ul>
      ) : null}
      {extraTimers > 0 ? (
        <p className="mt-2 text-xs text-fg-tertiary">另有 {extraTimers} 个定时任务</p>
      ) : null}
      {briefs.length > 0 ? (
        <div className={timers.length > 0 ? "mt-4 border-t border-border-subtle pt-3" : ""}>
          <div className="mb-1 flex items-center gap-2">
            <RefreshCw size={14} className="text-fg-tertiary" />
            <h4 className="text-xs font-medium text-fg-secondary">同一份简报</h4>
          </div>
          <p className="mb-2 text-xs text-fg-tertiary">
            再次运行仍使用这一份任务。新版本会对照当前交付，显示相对上一版的变化。
          </p>
          <ul className="space-y-1.5">
            {briefs.map((brief) => (
              <li key={brief.work_id} className="text-xs">
                <Link
                  to={taskPath(brief.work_id)}
                  className="text-fg-primary hover:underline"
                >
                  {brief.title || "项目简报"} · 当前 v{brief.version}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
