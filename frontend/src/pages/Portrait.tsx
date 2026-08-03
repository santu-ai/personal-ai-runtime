import {
  User,
  Heart,
  Target,
  Users,
  Dumbbell,
  Wallet,
  Briefcase,
  Sparkles,
  AlertCircle,
  Loader2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { usePortraitQuery } from "../hooks/usePortraitQuery";

const CATEGORY_META: Record<string, { label: string; icon: typeof User; description: string }> = {
  preferences: { label: "偏好", icon: Heart, description: "你的喜好与倾向" },
  values: { label: "价值观", icon: Sparkles, description: "你的信念与原则" },
  relationships: { label: "关系", icon: Users, description: "你的人际关系网络" },
  health: { label: "健康", icon: Dumbbell, description: "你的身心健康" },
  finance: { label: "财务", icon: Wallet, description: "你的财务相关" },
  career: { label: "职业", icon: Briefcase, description: "你的职业发展" },
};

function confidenceLevel(score: number): { color: string; label: string; pct: number } {
  const pct = Math.round(score * 100);
  if (pct >= 80) return { color: "bg-success", label: "高可信", pct };
  if (pct >= 50) return { color: "bg-warning", label: "中等可信", pct };
  return { color: "bg-danger", label: "低可信", pct };
}

/** Portrait content — embedded as a Memories tab; also used by tests. */
export function PortraitPanel({ compact = false }: { compact?: boolean }) {
  const { data, isLoading: loading, error: queryError, refetch } = usePortraitQuery();
  const error =
    queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null;

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${compact ? "py-16" : "h-full"}`}>
        <div className="flex flex-col items-center gap-3 text-fg-secondary">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">正在生成你的 AI 画像…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={`flex items-center justify-center ${compact ? "py-16" : "h-full"}`}>
        <div className="flex flex-col items-center gap-3 text-fg-secondary">
          <AlertCircle size={32} className="text-danger" />
          <p className="text-sm">{error}</p>
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-2 px-4 py-2 mt-2 text-sm bg-surface-overlay hover:bg-border-strong text-white rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      </div>
    );
  }

  const profileEntries = Object.entries(data?.profile ?? {});
  const totalItems =
    profileEntries.length + (data?.habits?.length ?? 0) + (data?.goals?.length ?? 0);

  return (
    <div className={compact ? "" : "h-full overflow-y-auto"}>
      {!compact && (
        <div className="p-6 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-insight/20 flex items-center justify-center">
              <User size={24} className="text-insight" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-fg-primary">AI 画像</h1>
              <p className="text-sm text-fg-secondary mt-1">
                AI 对你的理解——包含 {totalItems} 项洞察
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={compact ? "space-y-8" : "p-6 space-y-8"}>
        {compact && (
          <p className="text-sm text-fg-tertiary">AI 对你的理解——包含 {totalItems} 项洞察</p>
        )}

        {error && data && (
          <div className="flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            刷新失败：{error}
            <button type="button" onClick={() => void refetch()} className="underline ml-auto">
              重试
            </button>
          </div>
        )}

        {totalItems === 0 && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/10 border border-warning/20">
            <AlertCircle size={20} className="text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-warning text-sm font-medium">画像尚未建立</p>
              <p className="text-warning/70 text-xs mt-1">
                与 AI 多聊几次后，它会逐渐了解你的偏好、习惯和目标。
                <br />
                新用户通常在 5 分钟内看到自己的初始画像。
              </p>
            </div>
          </div>
        )}

        {profileEntries.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
              <User size={20} className="text-insight" />
              用户画像
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {profileEntries.map(([category, item]) => {
                if (!item) return null;
                const meta = CATEGORY_META[category] ?? {
                  label: category,
                  icon: User,
                  description: "",
                };
                const Icon = meta.icon;
                const conf = confidenceLevel(item.confidence);
                return (
                  <div
                    key={category}
                    className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4 hover:border-border-strong transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Icon size={18} className="text-insight" />
                      <h3 className="text-sm font-medium text-fg-primary">{meta.label}</h3>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(item.data).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-fg-tertiary">{key}：</span>
                          <span className="text-fg-primary">{String(value)}</span>
                        </div>
                      ))}
                      {Object.keys(item.data).length === 0 && (
                        <p className="text-xs text-fg-tertiary">暂无数据</p>
                      )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-border-strong/50">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-border-strong rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${conf.color}`}
                            style={{ width: `${conf.pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-fg-tertiary">{conf.pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {(data?.habits?.length ?? 0) > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
              <RefreshCw size={20} className="text-insight" />
              习惯
            </h2>
            <div className="space-y-2">
              {data!.habits.map((habit) => {
                const conf = confidenceLevel(habit.confidence);
                return (
                  <div
                    key={habit.id}
                    className="flex items-start gap-4 bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4 hover:border-border-strong transition-colors"
                  >
                    <ChevronRight size={18} className="text-insight mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-fg-primary">{habit.content}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${conf.color}`} />
                          <span className="text-xs text-fg-tertiary">{conf.label}</span>
                        </div>
                        <span className="text-xs text-fg-disabled">
                          {habit.origin === "self_report" ? "来自你的告知" : "AI 推断"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {(data?.goals?.length ?? 0) > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
              <Target size={20} className="text-insight" />
              当前目标
            </h2>
            <div className="space-y-3">
              {data!.goals.map((goal) => (
                <div
                  key={goal.id}
                  className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4 hover:border-border-strong transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-fg-primary">{goal.title}</h3>
                    <span className="text-xs text-insight">
                      {goal.progress > 0 ? `${goal.progress}%` : "待开始"}
                    </span>
                  </div>
                  {goal.progress > 0 && (
                    <div className="h-1.5 bg-border-strong rounded-full overflow-hidden">
                      <div
                        className="h-full bg-insight rounded-full transition-all"
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                  )}
                  {goal.deadline && (
                    <p className="text-xs text-fg-tertiary mt-2">截止: {goal.deadline}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
