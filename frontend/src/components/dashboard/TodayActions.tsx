import { useNavigate } from "react-router-dom";
import { ShieldCheck, Target, Mail, Activity } from "lucide-react";
import { type Goal } from "../../api/client";
import { formatTime } from "../../utils/time";

interface TodayActionsProps {
  pendingApprovals: Array<{
    id: string;
    action?: string;
    status?: string;
    params?: string;
    created_at?: string;
    expires_at?: string;
  }>;
  activeGoals: Goal[];
  pendingInboxCount: number;
  inboxEmails: Array<{ id: string; subject?: string }>;
}

export default function TodayActions({
  pendingApprovals,
  activeGoals,
  pendingInboxCount,
  inboxEmails,
}: TodayActionsProps) {
  const navigate = useNavigate();
  const pendingApprovalCount = pendingApprovals.length;
  const hasActions = pendingApprovalCount > 0 || activeGoals.length > 0 || pendingInboxCount > 0;

  if (!hasActions) {
    return (
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-10 text-center mb-6">
        <div className="text-fg-tertiary mb-3">
          <Activity size={36} className="mx-auto mb-3 opacity-40" />
        </div>
        <p className="text-fg-secondary font-medium mb-1">今天暂无紧急事项</p>
        <p className="text-sm text-fg-tertiary">去和 AI 聊聊天，或创建第一个目标开始使用</p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      {pendingApprovalCount > 0 ? (
        /* 有审批：审批 2/3 + 目标 1/3 */
        <div className="flex gap-3">
          <div className="w-2/3">
            <div className="bg-surface-raised border border-warning/40 rounded-xl p-5 h-full">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={18} className="text-warning" />
                <h3 className="text-sm font-semibold text-fg-primary">待你决断</h3>
                <span className="ml-auto text-xs text-warning font-medium">
                  {pendingApprovalCount} 项
                </span>
              </div>
              <div className="space-y-2">
                {pendingApprovals.slice(0, 3).map((item) => {
                  const isExpiring = item.expires_at
                    ? new Date(item.expires_at).getTime() - Date.now() < 3600000
                    : false;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 text-xs p-2 bg-warning/5 rounded-lg border border-warning/20"
                    >
                      <span className="text-warning shrink-0">{isExpiring ? "⏱" : "⚠"}</span>
                      <span className="text-fg-primary truncate flex-1">{item.action || "—"}</span>
                      {item.expires_at && (
                        <span
                          className={`shrink-0 ${isExpiring ? "text-danger" : "text-fg-tertiary"}`}
                        >
                          {formatTime(item.expires_at)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {pendingApprovals.length > 3 && (
                  <div className="text-xs text-fg-tertiary text-center">
                    ...还有 {pendingApprovals.length - 3} 项
                  </div>
                )}
              </div>
              <button
                onClick={() => navigate("/approvals")}
                className="mt-3 flex items-center gap-1.5 px-4 py-2 bg-warning/10 hover:bg-warning/20 text-warning rounded-lg text-sm font-medium transition-colors w-full justify-center"
              >
                <ShieldCheck size={14} />
                去处理
              </button>
            </div>
          </div>

          <div className="w-1/3 space-y-3">
            {/* 进行中目标 */}
            {activeGoals.length > 0 && (
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Target size={14} className="text-warning" />
                  <span className="text-xs font-medium text-fg-secondary">进行中</span>
                  <span className="text-xs text-fg-tertiary ml-auto">{activeGoals.length}</span>
                </div>
                <div className="space-y-1.5">
                  {activeGoals.slice(0, 3).map((g) => (
                    <div key={g.id} className="flex items-center gap-2 text-xs">
                      <span className="truncate flex-1 text-fg-primary">{g.title}</span>
                      <span className="text-fg-tertiary shrink-0">
                        {Math.round(g.progress * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => navigate("/goals")}
                  className="mt-2 text-xs text-insight hover:text-insight/80 transition-colors"
                >
                  查看全部 →
                </button>
              </div>
            )}

            {/* 待处理邮件 */}
            {pendingInboxCount > 0 && (
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Mail size={14} className="text-insight" />
                  <span className="text-xs font-medium text-fg-secondary">待处理邮件</span>
                  <span className="text-xs text-fg-tertiary ml-auto">{pendingInboxCount} 封</span>
                </div>
                <div className="space-y-1.5">
                  {inboxEmails.slice(0, 2).map((e) => (
                    <div key={e.id} className="text-xs text-fg-secondary truncate">
                      {e.subject}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => navigate("/inbox")}
                  className="mt-2 text-xs text-insight hover:text-insight/80 transition-colors"
                >
                  查看全部 →
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 无审批：目标 + 邮件各半 */
        <div className="flex gap-3">
          {activeGoals.length > 0 && (
            <div className="flex-1 bg-surface-raised border border-border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Target size={18} className="text-warning" />
                <h3 className="text-sm font-semibold text-fg-primary">进行中目标</h3>
                <span className="ml-auto text-xs text-fg-tertiary">{activeGoals.length} 项</span>
              </div>
              <div className="space-y-2.5">
                {activeGoals.slice(0, 5).map((g) => (
                  <div key={g.id} className="flex items-center gap-3">
                    <span className="text-sm text-fg-primary truncate flex-1">{g.title}</span>
                    <span className="text-xs text-fg-tertiary shrink-0">
                      {Math.round(g.progress * 100)}%
                    </span>
                    <div className="w-16 h-1 bg-surface-overlay rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full bg-insight rounded-full"
                        style={{ width: `${Math.round(g.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate("/goals")}
                className="mt-3 text-xs text-insight hover:text-insight/80 transition-colors"
              >
                查看全部 →
              </button>
            </div>
          )}
          {pendingInboxCount > 0 && (
            <div className="flex-1 bg-surface-raised border border-border-subtle rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Mail size={18} className="text-insight" />
                <h3 className="text-sm font-semibold text-fg-primary">待处理邮件</h3>
                <span className="ml-auto text-xs text-fg-tertiary">{pendingInboxCount} 封</span>
              </div>
              <div className="space-y-2.5">
                {inboxEmails.slice(0, 5).map((e) => (
                  <div key={e.id} className="text-sm text-fg-secondary truncate">
                    {e.subject}
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate("/inbox")}
                className="mt-3 text-xs text-insight hover:text-insight/80 transition-colors"
              >
                查看全部 →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
