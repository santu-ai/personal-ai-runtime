import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SegmentedControl from "./SegmentedControl";

const options = [
  { value: "list", label: "列表" },
  { value: "review", label: "待确认" },
  { value: "graph", label: "图谱" },
  { value: "portrait", label: "画像" },
] as const;

function Harness({ initial = "list" }: { initial?: (typeof options)[number]["value"] }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      aria-label="记忆视图"
      value={value}
      onChange={setValue}
      options={[...options]}
    />
  );
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

describe("SegmentedControl", () => {
  it("keeps only the selected tab in the tab order and uses the timeline focus ring", () => {
    render(<Harness />);
    expect(tab("列表")).toHaveAttribute("tabindex", "0");
    expect(tab("待确认")).toHaveAttribute("tabindex", "-1");
    expect(tab("图谱")).toHaveAttribute("tabindex", "-1");
    expect(tab("画像")).toHaveAttribute("tabindex", "-1");
    expect(tab("列表").className.split(/\s+/)).toEqual(
      expect.arrayContaining(["focus-visible:ring-2", "focus-visible:ring-focus-ring"]),
    );
  });

  it("switches with arrow keys and stops at the ends", () => {
    render(<Harness />);
    const list = tab("列表");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("待确认")).toHaveFocus();
    expect(tab("待确认")).toHaveAttribute("aria-selected", "true");
    expect(tab("待确认")).toHaveAttribute("tabindex", "0");
    expect(tab("列表")).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(tab("待确认"), { key: "ArrowDown" });
    expect(tab("图谱")).toHaveFocus();
    fireEvent.keyDown(tab("图谱"), { key: "ArrowRight" });
    expect(tab("画像")).toHaveFocus();
    fireEvent.keyDown(tab("画像"), { key: "ArrowRight" });
    expect(tab("画像")).toHaveFocus();
    expect(tab("画像")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("画像"), { key: "ArrowLeft" });
    expect(tab("图谱")).toHaveFocus();
    fireEvent.keyDown(tab("图谱"), { key: "ArrowUp" });
    expect(tab("待确认")).toHaveFocus();
    fireEvent.keyDown(tab("待确认"), { key: "Home" });
    expect(tab("列表")).toHaveFocus();
    fireEvent.keyDown(tab("列表"), { key: "ArrowLeft" });
    expect(tab("列表")).toHaveFocus();
    fireEvent.keyDown(tab("列表"), { key: "End" });
    expect(tab("画像")).toHaveFocus();
  });

  it("does not switch while an IME process key or a modifier is down", () => {
    render(<Harness />);
    const list = tab("列表");
    list.focus();

    expect(fireEvent.keyDown(list, { key: "ArrowRight", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "ArrowRight", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "ArrowRight", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "ArrowRight", altKey: true })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "ArrowRight", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(list, { key: "ArrowRight", metaKey: true })).toBe(true);

    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");
    expect(tab("待确认")).toHaveAttribute("aria-selected", "false");
  });
});
