import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input, PasswordInput, TextArea, passwordInputLayoutFocus } from "./Input";

function hasBareOutlineNone(className: string): boolean {
  return className.split(/\s+/).includes("outline-none");
}

describe("PasswordInput", () => {
  afterEach(() => {
    passwordInputLayoutFocus.notify = null;
  });

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

  it("puts the caret back before paint when the field was focused", () => {
    render(<PasswordInput aria-label="密钥" value="sk-secret" onChange={vi.fn()} />);
    const input = screen.getByLabelText("密钥");
    input.focus();
    (input as HTMLInputElement).setSelectionRange(2, 2);
    let focusedDuringLayout: Element | null = null;
    passwordInputLayoutFocus.notify = () => {
      focusedDuringLayout = document.activeElement;
    };
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    passwordInputLayoutFocus.notify = null;

    const revealed = screen.getByLabelText("密钥");
    expect(revealed).toHaveAttribute("type", "text");
    expect(focusedDuringLayout).toBe(revealed);
    expect(revealed).toHaveFocus();
    expect(revealed).toHaveProperty("selectionStart", 2);

    focusedDuringLayout = null;
    passwordInputLayoutFocus.notify = () => {
      focusedDuringLayout = document.activeElement;
    };
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    passwordInputLayoutFocus.notify = null;
    const hidden = screen.getByLabelText("密钥");
    expect(hidden).toHaveAttribute("type", "password");
    expect(focusedDuringLayout).toBe(hidden);
    expect(hidden).toHaveFocus();
  });

  it("does not pull focus into the field when it was already elsewhere", () => {
    const { unmount } = render(
      <>
        <PasswordInput aria-label="密钥" value="sk-secret" onChange={vi.fn()} />
        <button type="button">旁边</button>
      </>,
    );
    const eye = screen.getByRole("button", { name: "显示密码" });
    eye.focus();
    fireEvent.click(eye);
    expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveFocus();
    expect(screen.getByLabelText("密钥")).not.toHaveFocus();
    unmount();

    render(
      <>
        <PasswordInput aria-label="密钥" value="sk-secret" onChange={vi.fn()} />
        <button type="button">旁边</button>
      </>,
    );
    screen.getByRole("button", { name: "旁边" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(screen.getByRole("button", { name: "旁边" })).toHaveFocus();
    expect(screen.getByLabelText("密钥")).toHaveAttribute("type", "text");
  });

  it("keeps focus on an empty field when a saved secret is revealed", () => {
    render(
      <PasswordInput
        aria-label="密钥"
        value="••••••••"
        isSavedSecret
        onChange={vi.fn()}
        placeholder="原始占位"
      />,
    );
    const input = screen.getByLabelText("密钥");
    input.focus();
    let focusedDuringLayout: Element | null = null;
    passwordInputLayoutFocus.notify = () => {
      focusedDuringLayout = document.activeElement;
    };
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    passwordInputLayoutFocus.notify = null;
    const revealed = screen.getByPlaceholderText("密钥已保存，不可查看原文；输入新值以替换");
    expect(focusedDuringLayout).toBe(revealed);
    expect(revealed).toHaveFocus();
    expect(revealed).toHaveValue("");
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
