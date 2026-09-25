import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

interface HomeConversationGate {
  /** 这次创建还没回来时返回 false，调用方不再开一份。 */
  tryHold: () => boolean;
  release: () => void;
}

const HomeConversationGateContext = createContext<HomeConversationGate | null>(null);

/**
 * 首页「发送」「开始对话」和侧栏「新对话」共用。
 * 收件箱「让 AI 处理」、目标「就此目标对话」、记忆「继续聊」不走这里。
 */
export function HomeConversationGateProvider({ children }: { children: ReactNode }) {
  const held = useRef(false);
  const gate = useMemo<HomeConversationGate>(
    () => ({
      tryHold() {
        if (held.current) return false;
        held.current = true;
        return true;
      },
      release() {
        held.current = false;
      },
    }),
    [],
  );
  return (
    <HomeConversationGateContext.Provider value={gate}>
      {children}
    </HomeConversationGateContext.Provider>
  );
}

/** 有上层锁时用同一把；单独渲染首页时仍按住这一页自己的创建。 */
export function useHomeConversationGate(): HomeConversationGate {
  const shared = useContext(HomeConversationGateContext);
  const held = useRef(false);
  const local = useMemo<HomeConversationGate>(
    () => ({
      tryHold() {
        if (held.current) return false;
        held.current = true;
        return true;
      },
      release() {
        held.current = false;
      },
    }),
    [],
  );
  return shared ?? local;
}
