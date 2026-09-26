import { describe, expect, it } from "vitest";
import { isImeKeyboardEvent } from "./imeKey";

describe("isImeKeyboardEvent", () => {
  it("treats an in-progress composition as IME", () => {
    expect(isImeKeyboardEvent({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(true);
  });

  it("treats the process key as IME even when isComposing is already false", () => {
    expect(isImeKeyboardEvent({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ key: "Enter", which: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ key: "Process", isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeKeyboardEvent({ key: "Escape", keyCode: 229 })).toBe(true);
  });

  it("leaves a finished key alone", () => {
    expect(isImeKeyboardEvent({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeKeyboardEvent({ key: "Escape" })).toBe(false);
    expect(isImeKeyboardEvent({ key: "m", keyCode: 77 })).toBe(false);
  });
});
