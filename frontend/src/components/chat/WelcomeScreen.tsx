import {
  Zap,
  MailSearch,
  Target as TargetIcon,
  BrainCircuit,
  Lightbulb,
  FileText,
  Globe,
  Mail,
  Calendar,
  Brain,
} from "lucide-react";
import { type MemoryRow } from "../../api/client";
import PromptChipFace from "./PromptChipFace";

const MEMORY_PREVIEW = 60;
const SUGGESTION_PREVIEW = 50;

const SUGGESTION_META: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  目标: { icon: TargetIcon },
  收件箱: { icon: MailSearch },
  对话: { icon: BrainCircuit },
  规划: { icon: Lightbulb },
};

const CAPABILITY_CHIPS: Array<{
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  prompt: string;
}> = [
  { icon: FileText, label: "读写文件", prompt: "帮我在桌面创建一个 todo.md，列出今天的任务" },
  { icon: Globe, label: "搜索网页", prompt: "帮我搜索最新的 Python 3.13 特性并总结" },
  { icon: Mail, label: "处理邮件", prompt: "帮我看看收件箱有什么重要的邮件" },
  { icon: Calendar, label: "管理日程", prompt: "我这周有什么日历日程？" },
  { icon: TargetIcon, label: "规划目标", prompt: "帮我设定一个本周目标并拆解步骤" },
  { icon: Brain, label: "记住信息", prompt: "我想让你记住一些关于我的事情" },
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
  onPickPrompt: (prompt: string, source?: EventTarget | null) => void;
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

          {recentMemories.length > 0 && (
            <div className="mb-5 text-left bg-insight/10 border border-insight/30 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <BrainCircuit size={14} className="text-insight" />
                <span className="text-xs text-insight font-medium">我记得你</span>
              </div>
              <div className="space-y-1.5">
                {recentMemories.map((m) => {
                  const clipped = m.content.length > MEMORY_PREVIEW;
                  const shown = `· ${m.content}`;
                  const preview = clipped ? `· ${m.content.slice(0, MEMORY_PREVIEW)}…` : shown;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={(e) =>
                        onPickPrompt(
                          `你记得我${m.category === "preference" ? "喜欢" : m.category === "fact" ? "" : "的"}「${m.content.slice(0, MEMORY_PREVIEW)}」，基于这个继续聊聊`,
                          e.currentTarget,
                        )
                      }
                      className={`group block w-full min-w-0 text-left text-xs text-fg-secondary hover:text-insight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded${
                        clipped ? "" : " truncate"
                      }`}
                      title={m.content}
                      aria-label={clipped ? shown : undefined}
                    >
                      {clipped ? (
                        <PromptChipFace
                          preview={<span className="block truncate">{preview}</span>}
                          full={shown}
                          previewClassName="block min-w-0 max-w-full group-focus-visible:hidden"
                          fullClassName="hidden whitespace-normal text-left group-focus-visible:block"
                        />
                      ) : (
                        preview
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {CAPABILITY_CHIPS.map((c) => {
              const ChipIcon = c.icon;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={(e) => onPickPrompt(c.prompt, e.currentTarget)}
                  className="group inline-flex max-w-full items-center text-xs px-2.5 py-1.5 bg-surface-overlay/60 hover:bg-surface-overlay text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  title={c.prompt}
                  aria-label={c.prompt}
                >
                  <PromptChipFace
                    preview={
                      <>
                        <ChipIcon size={13} aria-hidden />
                        <span>{c.label}</span>
                      </>
                    }
                    full={c.prompt}
                  />
                </button>
              );
            })}
          </div>
          <p className="text-xs text-fg-disabled mb-6">点击能力胶囊快速开始，或在下方直接输入</p>
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {suggestions.map((s) => {
              const SIcon = getSuggestionIcon(s);
              const clipped = s.length > SUGGESTION_PREVIEW;
              const preview = clipped ? `${s.slice(0, SUGGESTION_PREVIEW)}…` : s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={(e) => onPickPrompt(s, e.currentTarget)}
                  className="group inline-flex max-w-full items-center gap-1.5 text-xs px-3 py-2 bg-surface-overlay hover:bg-border-strong text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  title={clipped ? s : undefined}
                  aria-label={clipped ? s : undefined}
                >
                  {clipped ? (
                    <PromptChipFace
                      preview={
                        <>
                          <SIcon size={13} className="text-fg-secondary" aria-hidden />
                          <span>{preview}</span>
                        </>
                      }
                      full={s}
                    />
                  ) : (
                    <>
                      <SIcon size={13} className="text-fg-secondary" aria-hidden />
                      <span>{preview}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
