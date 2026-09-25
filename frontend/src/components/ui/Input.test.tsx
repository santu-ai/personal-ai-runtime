import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input, PasswordInput, TextArea } from "./Input";

function hasBareOutlineNone(className: string): boolean {
  return className.split(/\s+/).includes("outline-none");
}

describe("PasswordInput", () => {
  it("toggles input type between password and text", () => {
    const { container } = render(<PasswordInput value="sk-secret" onChange={vi.fn()} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect((container.querySelector("input") as HTMLInputElement).type).toBe("text");
    expect(screen.getByDisplayValue("sk-secret")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect((container.querySelector("input") as HTMLInputElement).type).toBe("password");
  });

  it("shows hint placeholder when revealing saved masked secret", () => {
    render(
      <PasswordInput value="••••••••" isSavedSecret onChange={vi.fn()} placeholder="原始占位" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(
      screen.getByPlaceholderText("密钥已保存，不可查看原文；输入新值以替换"),
    ).toBeInTheDocument();
  });

  it("uses the timeline focus ring on text fields", () => {
    const { container } = render(
      <div>
        <Input aria-label="名称" />
        <TextArea aria-label="说明" />
        <PasswordInput aria-label="密钥" value="" onChange={vi.fn()} />
      </div>,
    );
    const fields = container.querySelectorAll("input, textarea");
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const field of fields) {
      expect(field).toHaveClass("focus-visible:ring-2", "focus-visible:ring-focus-ring");
      expect(hasBareOutlineNone(field.className)).toBe(false);
    }
  });

  it("keeps a danger ring when the field is invalid", () => {
    render(<Input aria-label="名称" invalid />);
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveClass("focus-visible:ring-danger");
  });
});
