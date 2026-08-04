import { create } from "zustand";
import type { Conversation } from "../api/client";

interface ChatState {
  /** Query 缓存的乐观镜像——不要作为独立真相源。

   * 真实列表在 TanStack Query 的 `["conversations"]` key；本字段仅用于
   * 跨组件共享乐观更新（新建/删除/改标题即时反馈，防 refetch 回滚）。
   * 见 useConversationsQuery.ts 的双写 helper。
   */
  conversations: Conversation[];
  activeConversationId: string | null;
  pendingPrompt: string | null;

  setConversations: (convs: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
  addConversation: (conv: Conversation) => void;
  removeConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;
  setPendingPrompt: (prompt: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversationId: null,
  pendingPrompt: null,

  setConversations: (convs) => set({ conversations: convs }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  addConversation: (conv) => set((state) => ({ conversations: [conv, ...state.conversations] })),
  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
    })),
  updateConversationTitle: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    })),
  setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
}));
