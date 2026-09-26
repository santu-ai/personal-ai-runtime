/**
 * 时间线徽章和记忆来源链共用的执行者。认识的写成中文，不认识的仍是原来的字。
 * 空白不当成一个名字。
 */
const ACTOR_LABELS: Record<string, string> = {
  user: "你",
  scheduler: "定时",
  system: "系统",
  api: "本机",
  brain: "AI",
  extractor: "AI",
  local_llm: "AI",
};

export function actorLabel(actor: string | null | undefined): string {
  const key = (actor ?? "").trim();
  if (!key) return "";
  if (key.startsWith("agent:")) return "AI";
  return ACTOR_LABELS[key] ?? key;
}
