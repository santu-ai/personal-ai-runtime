import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 引导、任务、来源和今天页用 text-fg-tertiary / text-success / text-warning / text-danger
 * 写说明和状态。正文要达到 WCAG AA 4.5:1。色值改了这里会失败。
 */

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const red = linear(parseInt(raw.slice(0, 2), 16));
  const green = linear(parseInt(raw.slice(2, 4), 16));
  const blue = linear(parseInt(raw.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
  expect(match, selector).not.toBeNull();
  const open = match!.index + match![0].length - 1;
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match, name).not.toBeNull();
  return match![1];
}

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

const DARK_SURFACES = ["#0b0d12", "#161a22", "#1e2430"];
const LIGHT_SURFACES = ["#f4f5f7", "#ffffff", "#f0f2f5"];

describe("primary flow contrast", () => {
  const root = block(css, ":root");
  const light = block(css, 'html[data-theme="light"]');
  const autoLight = block(css, ':root:not([data-theme="dark"])');

  it("keeps secondary text at least 4.5:1 on the surfaces those pages use", () => {
    const darkText = token(root, "--token-fg-tertiary");
    for (const surface of DARK_SURFACES) {
      expect(contrast(darkText, surface)).toBeGreaterThanOrEqual(4.5);
    }
    const lightText = token(light, "--token-fg-tertiary");
    expect(token(autoLight, "--token-fg-tertiary")).toBe(lightText);
    for (const surface of LIGHT_SURFACES) {
      expect(contrast(lightText, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps success, warning, and danger text readable in the light theme", () => {
    for (const name of ["--token-success", "--token-warning", "--token-danger"]) {
      const color = token(light, name);
      for (const surface of LIGHT_SURFACES) {
        expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast("#ffffff", color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
