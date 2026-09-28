import { screen, waitFor } from "@testing-library/react";

/** 状态区域常驻；空区域表示还没有通知，不等同于缺少 DOM 节点。 */
export function announcements(): HTMLElement[] {
  return screen.queryAllByRole("status").filter((node) => Boolean(node.textContent?.trim()));
}

export function queryAnnouncement(): HTMLElement | null {
  const nodes = announcements();
  if (nodes.length > 1) throw new Error(`Expected one announcement, got ${nodes.length}`);
  return nodes[0] ?? null;
}

export function findAnnouncement(): Promise<HTMLElement> {
  return waitFor(() => {
    const node = queryAnnouncement();
    if (!node) throw new Error("No announcement yet");
    return node;
  });
}
