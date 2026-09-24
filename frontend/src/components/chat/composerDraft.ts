/** Unsent chat composer text, kept per conversation for this browser tab. */

const PREFIX = "par.composer-draft:";
const memory = new Map<string, string>();

export const COMPOSER_DRAFT_HOME = "home";

function storageKey(id: string): string {
  return `${PREFIX}${id}`;
}

export function readComposerDraft(id: string): string {
  const cached = memory.get(id);
  if (cached !== undefined) return cached;
  try {
    const stored = sessionStorage.getItem(storageKey(id));
    if (!stored) return "";
    memory.set(id, stored);
    return stored;
  } catch {
    return "";
  }
}

export function writeComposerDraft(id: string, value: string): void {
  if (!value) {
    memory.delete(id);
    try {
      sessionStorage.removeItem(storageKey(id));
    } catch {
      // Storage can be blocked. The in-memory copy is already gone.
    }
    return;
  }
  memory.set(id, value);
  try {
    sessionStorage.setItem(storageKey(id), value);
  } catch {
    // Keep the tab copy when sessionStorage rejects the write.
  }
}

export function clearComposerDrafts(): void {
  memory.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Nothing else to clear.
  }
}
