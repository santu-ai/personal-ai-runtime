import { useEffect, useState, type HTMLAttributes } from "react";

interface Props extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  message?: string | null;
  /** 同文案的新事件也要重新播报；不要用 React key 重建状态区域。 */
  announcementId?: string | number;
  as?: "span" | "p";
}

/** 先挂载空的状态区域，再更新文字，让辅助技术能订阅首次通知。 */
export default function LiveStatus({
  message,
  announcementId,
  className = "sr-only",
  as: Tag = "span",
  ...props
}: Props) {
  const text = message ?? "";
  const [delivered, setDelivered] = useState<{ text: string; id?: string | number } | null>(null);
  useEffect(() => {
    // 清空后再填入也使连续两次相同文案产生可观察的内容变化。
    setDelivered(null);
    if (!text) return;
    const timer = window.setTimeout(() => setDelivered({ text, id: announcementId }), 100);
    return () => window.clearTimeout(timer);
  }, [text, announcementId]);
  const current = delivered?.text === text && delivered.id === announcementId;
  return (
    <Tag {...props} role="status" aria-atomic="true" className={className}>
      {current ? delivered.text : ""}
    </Tag>
  );
}
