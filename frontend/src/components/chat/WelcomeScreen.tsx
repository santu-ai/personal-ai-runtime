import { Zap, MailSearch, Target as TargetIcon, BrainCircuit, Lightbulb } from "lucide-react";
import { type MemoryRow } from "../../api/client";

const SUGGESTION_META: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  目标: { icon: TargetIcon },
  收件箱: { icon: MailSearch },
  对话: { icon: BrainCircuit },
  规划: { icon: Lightbulb },
};

const CAPABILITY_CHIPS: Array<{ icon: string; label: string; prompt: string }> = [
  { icon: "📄", label: "读写文件", prompt: "帮我在桌面创建一个 todo.md，列出今天的任务" },
  { icon: "🌐", label: "搜索网页", prompt: "帮我搜索最新的 Python 3.13 特性并总结" },
  { icon: "📬", label: "处理邮件", prompt: "帮我看看收件箱有什么重要的邮件" },
  { icon: "📅", label: "管理日程", prompt: "我这周有什么日历日程？" },
  { icon: "🎯", label: "规划目标", prompt: "帮我设定一个本周目标并拆解步骤" },
  { icon: "🧠", label: "记住信息", prompt: "我想让你记住一些关于我的事情" },
];

function getSuggestionIcon(label: string) {
  for (const [key, meta] of Object.entries(SUGGESTION_META)) {
    if (label.includes(key)) return meta.icon;
  }
  return Zap;
}

interface WelcomeScreenProps {
  recentMemories: MemoryRow[];
  suggestions: string[];
  onPickPrompt: (prompt: string) => void;
}

export default function WelcomeScreen({
  recentMemories,
  suggestions,
  onPickPrompt,
}: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-lg w-full text-center">
          <BrainCircuit size={36} strokeWidth={1.5} className="mx-auto mb-4 text-insight" />
          <h2 className="text-xl font-semibold text-fg-primary mb-2">开始对话</h2>
          <p className="text-sm text-fg-tertiary mb-4">
            我是你的个人 AI 助手。所有数据保存在你的机器上，完全私有。
          </p>

          {/* 我记得你 —— 记忆驱动连续性 */}
          {recentMemories.length > 0 && (
            <div className="mb-5 text-left bg-insight/10 border border-insight/30 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <BrainCircuit size={14} className="text-insight" />
                <span className="text-xs text-insight font-medium">我记得你</span>
              </div>
              <div className="space-y-1.5">
                {recentMemories.map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      onPickPrompt(
                        `你记得我${m.category === "preference" ? "喜欢" : m.category === "fact" ? "" : "的"}「${m.content.slice(0, 60)}」，基于这个继续聊聊`,
                      )
                    }
                    className="block w-full text-left text-xs text-fg-secondary hover:text-insight transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                    title={m.content}
                  >
                    · {m.content.slice(0, 60)}
                    {m.content.length > 60 ? "…" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {CAPABILITY_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onPickPrompt(c.prompt)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-surface-overlay/60 hover:bg-surface-overlay text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                title={c.prompt}
              >
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-disabled mb-6">点击能力胶囊快速开始，或在下方直接输入</p>
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {suggestions.map((s) => {
              const SIcon = getSuggestionIcon(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPickPrompt(s)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 bg-surface-overlay hover:bg-border-strong text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <SIcon size={13} className="text-fg-secondary" />
                  <span>{s.length > 50 ? s.slice(0, 50) + "…" : s}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
