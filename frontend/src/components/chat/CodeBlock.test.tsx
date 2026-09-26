import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

const indexCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
  "utf8",
);

function surfaceOf(box: Element): Element | null {
  return box.querySelector("[data-code-surface]");
}

describe("CodeBlock long lines", () => {
  it("wraps a line longer than 80 characters when the keyboard lands on it", () => {
    const line = "a".repeat(81);
    const code = `short\n${line}`;
    render(<CodeBlock language="text" code={code} />);

    const box = document.querySelector("[data-code-reveal]");
    if (!box) throw new Error("missing code reveal");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("title", code);
    expect(box).toHaveClass(
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(box.className).not.toContain("group-hover:");
    expect(box.closest("button")).toBeNull();
    const copy = screen.getByRole("button", { name: "复制" });
    expect(copy.closest("[data-code-reveal]")).toBeNull();

    const surface = surfaceOf(box);
    expect(surface).toHaveClass("overflow-x-auto");
    expect(surface?.textContent).toContain(line);
    expect(surface?.className).not.toContain("group-focus-visible:");
    expect(surface?.className).not.toContain("group-hover:");

    expect(indexCss).toContain("[data-code-reveal]:focus-visible [data-code-surface]");
    expect(indexCss).toContain("[data-code-reveal]:focus-visible [data-code-surface] code");
    expect(indexCss).toContain("overflow: visible !important");
    expect(indexCss).toContain("white-space: pre-wrap !important");
    expect(indexCss).toContain("word-break: break-all !important");

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);
    expect(copy).toHaveAttribute("aria-label", "复制");
  });

  it("does not add a focus stop when every line is at most 80 characters", () => {
    const exact = "b".repeat(80);
    const tall = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
    const { rerender } = render(<CodeBlock language="js" code={exact} />);
    expect(document.querySelector("[data-code-reveal]")).toBeNull();
    expect(document.querySelector("[data-code-surface]")).toHaveClass("overflow-x-auto");

    rerender(<CodeBlock language="js" code={tall} />);
    expect(document.querySelector("[data-code-reveal]")).toBeNull();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
  });

  it("still copies the long block", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const code = "c".repeat(81);
    render(<CodeBlock language="text" code={code} />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });
});
