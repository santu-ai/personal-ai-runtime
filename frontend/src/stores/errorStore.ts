import { create } from "zustand";

export interface ErrorItem {
  id: string;
  message: string;
  source?: string;
  timestamp: number;
}

interface ErrorState {
  errors: ErrorItem[];
  backendUnavailable: boolean;
  addError: (message: string, source?: string) => void;
  dismissError: (id: string) => void;
  setBackendUnavailable: (unavailable: boolean) => void;
}

let errorSeq = 0;

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],
  backendUnavailable: false,

  addError: (message, source) => {
    const prefix = source ? `[${source}] ` : "";
    console.error(`${prefix}${message}`);
    const id = `err-${Date.now()}-${++errorSeq}`;
    set((state) => ({
      errors: [{ id, message, source, timestamp: Date.now() }, ...state.errors].slice(0, 5),
    }));
  },

  dismissError: (id) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.id !== id),
    })),

  setBackendUnavailable: (unavailable) => set({ backendUnavailable: unavailable }),
}));
