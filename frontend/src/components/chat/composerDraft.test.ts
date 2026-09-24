import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_DRAFT_HOME,
  clearComposerDrafts,
  readComposerDraft,
  writeComposerDraft,
} from "./composerDraft";

describe("composerDraft", () => {
  afterEach(() => {
    clearComposerDrafts();
    vi.restoreAllMocks();
  });

  it("keeps each conversation draft and drops an empty write", () => {
    writeComposerDraft("conv-a", "还没发出");
    writeComposerDraft(COMPOSER_DRAFT_HOME, "首页这句");
    expect(readComposerDraft("conv-a")).toBe("还没发出");
    expect(readComposerDraft(COMPOSER_DRAFT_HOME)).toBe("首页这句");
    expect(readComposerDraft("conv-b")).toBe("");

    writeComposerDraft("conv-a", "");
    expect(readComposerDraft("conv-a")).toBe("");
    expect(readComposerDraft(COMPOSER_DRAFT_HOME)).toBe("首页这句");
  });

  it("reads a draft back from sessionStorage", () => {
    sessionStorage.setItem("par.composer-draft:conv-a", "刷新前写的");
    expect(readComposerDraft("conv-a")).toBe("刷新前写的");
    writeComposerDraft("conv-a", "");
    expect(sessionStorage.getItem("par.composer-draft:conv-a")).toBeNull();
  });

  it("keeps the tab copy when sessionStorage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    writeComposerDraft("conv-a", "只留在这一页");
    expect(readComposerDraft("conv-a")).toBe("只留在这一页");
  });
});
