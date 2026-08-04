import { useState } from "react";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { type ToolSummaryItem } from "../../api/client";
import { toolLabel } from "../../utils/toolLabels";

interface HealthPanelProps {
  cost: {
    total_prompt_tokens?: number;
    total_completion_tokens?: number;
    total_cost?: number;
    total_calls?: number;
    avg_latency_ms?: number;
    failed_calls?: number;
  } | null;
  tools: ToolSummaryItem[];
  memory: {
    total_memories?: number;
    recent_7d?: number;
    categories?: Record<string, number>;
  } | null;
  health: {
    task_queue_length?: number;
    tool_failure_rate_24h?: number;
  } | null;
  dashboard: {
    data_sovereignty?: {
      total_events?: number;
      total_memories?: number;
      total_goals?: number;
      total_conversations?: number;
      memories_self_report?: number;
      memories_claim?: number;
      goals_active?: number;
      goals_completed?: number;
    };
  } | null;
}

export default function HealthPanel({ cost, tools, memory, health, dashboard }: HealthPanelProps) {
  const [showHealth, setShowHealth] = useState(false);

  const totalTokens = (cost?.total_prompt_tokens || 0) + (cost?.total_completion_tokens || 0);
  const totalCalls = cost?.total_calls || 0;
  const successRate =
    totalCalls > 0
      ? (((totalCalls - (cost?.failed_calls || 0)) / totalCalls) * 100).toFixed(1)
      : "100";

  return (
    <div className="border-t border-border-subtle pt-4">
      <button
        onClick={() => setShowHealth(!showHealth)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-tertiary hover:text-fg-secondary transition-colors"
      >
        {showHealth ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>运行状况</span>
        {!showHealth && (
          <span className="text-fg-disabled ml-1">· Token / 成本 / 数据计数 ...</span>
        )}
      </button>

      {showHealth && (
        <div className="mt-3 space-y-5">
          {/* 我的数据 */}
          {dashboard?.data_sovereignty && (
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-success" />
                <h4 className="text-xs font-medium text-fg-secondary">我的数据</h4>
                <span className="ml-auto text-xs text-success">全部本地存储</span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-center mb-3">
                <div>
                  <div className="text-lg font-bold text-insight">
                    {(dashboard.data_sovereignty.total_events || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">事件</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-insight">
                    {(dashboard.data_sovereignty.total_memories || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">记忆</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-warning">
                    {(dashboard.data_sovereignty.total_goals || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">目标</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-insight">
                    {(dashboard.data_sovereignty.total_conversations || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">对话</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-fg-tertiary">
                <span>
                  自我陈述:{" "}
                  <span className="text-insight font-medium">
                    {dashboard.data_sovereignty.memories_self_report || 0}
                  </span>
                </span>
                <span>
                  AI 提炼:{" "}
                  <span className="text-warning font-medium">
                    {dashboard.data_sovereignty.memories_claim || 0}
                  </span>
                </span>
                <span>
                  目标:{" "}
                  <span className="text-success font-medium">
                    {dashboard.data_sovereignty.goals_active || 0}
                  </span>
                  <span className="text-fg-disabled">/</span>
                  <span className="text-fg-secondary font-medium">
                    {dashboard.data_sovereignty.goals_completed || 0}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* AI 记住了 */}
          {memory && (
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
              <h4 className="text-xs font-medium text-fg-secondary mb-3">AI 记住了</h4>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-insight">{memory.total_memories}</div>
                  <div className="text-xs text-fg-tertiary mt-0.5">条记忆</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-success">{memory.recent_7d}</div>
                  <div className="text-xs text-fg-tertiary mt-0.5">近 7 天</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-warning">
                    {Object.keys(memory.categories || {}).length}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-0.5">个分类</div>
                </div>
              </div>
              {Object.keys(memory.categories || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border-subtle flex flex-wrap gap-1.5">
                  {Object.entries(memory.categories || {}).map(([cat, count]) => (
                    <span
                      key={cat}
                      className="px-2 py-0.5 bg-surface-overlay rounded text-xs text-fg-secondary"
                    >
                      {cat}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LLM / 系统指标 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
              <div className="text-xs text-fg-tertiary mb-1">LLM 成功率</div>
              <div
                className="text-lg font-bold"
                style={{ color: Number(successRate) >= 95 ? "#10b981" : "#f59e0b" }}
              >
                {successRate}%
              </div>
            </div>
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
              <div className="text-xs text-fg-tertiary mb-1">任务队列</div>
              <div className="text-lg font-bold text-fg-secondary">
                {health?.task_queue_length ?? 0}
              </div>
            </div>
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
              <div className="text-xs text-fg-tertiary mb-1">工具失败率</div>
              <div
                className="text-lg font-bold"
                style={{
                  color: (health?.tool_failure_rate_24h || 0) < 0.05 ? "#10b981" : "#ef4444",
                }}
              >
                {((health?.tool_failure_rate_24h || 0) * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Token / 成本 */}
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
            <div className="text-xs text-fg-tertiary mb-3">Token 与成本 (7天)</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-tertiary">总 Token</span>
                <span className="text-fg-secondary font-mono">{totalTokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-tertiary">预估费用</span>
                <span className="text-fg-secondary font-mono">
                  ${(cost?.total_cost || 0).toFixed(4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-tertiary">调用次数</span>
                <span className="text-fg-secondary font-mono">{cost?.total_calls || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-tertiary">平均延迟</span>
                <span className="text-fg-secondary font-mono">
                  {(cost?.avg_latency_ms || 0).toFixed(0)}ms
                </span>
              </div>
            </div>
          </div>

          {/* 工具调用 */}
          {tools.length > 0 && (
            <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
              <div className="text-xs text-fg-tertiary mb-2">工具调用 (7天)</div>
              <div className="space-y-1">
                {tools.map((t: ToolSummaryItem) => {
                  const rate =
                    t.total_calls > 0
                      ? (((t.total_calls - t.failed_calls) / t.total_calls) * 100).toFixed(0)
                      : "0";
                  const color =
                    Number(rate) >= 95 ? "#10b981" : Number(rate) >= 80 ? "#f59e0b" : "#ef4444";
                  return (
                    <div
                      key={t.tool_name}
                      className="flex items-center justify-between py-1.5 text-xs"
                    >
                      <span className="text-fg-secondary">{toolLabel(t.tool_name)}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-fg-disabled">{t.total_calls} 次</span>
                        <span style={{ color }}>{rate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
