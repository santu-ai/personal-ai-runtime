import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Disclosure from "./Disclosure";

const description =
  "浏览并安装社区 MCP 服务器，收起时平时只占一行，键盘落到这一栏时要写出整句，鼠标悬停仍是一行。";

describe("Disclosure", () => {
  it("writes the full collapsed description when the section is keyboard focused", () => {
    render(
      <Disclosure title="MCP 市场" description={description}>
        <p>市场正文</p>
      </Disclosure>,
    );

    const button = screen.getByRole("button", { name: /MCP 市场/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("group", "focus-visible:ring-focus-ring");

    const line = button.querySelector(".line-clamp-1");
    expect(line).toHaveTextContent(description);
    expect(line).toHaveClass(
      "line-clamp-1",
      "group-focus-visible:line-clamp-none",
      "group-focus-visible:break-words",
    );
    expect(line?.className).not.toContain("group-hover:");
    expect(line).not.toHaveAttribute("title");
    expect(line).not.toHaveAttribute("tabindex");
    expect(line?.closest("button")).toBe(button);

    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("市场正文")).toBeInTheDocument();
    expect(button.querySelector(".line-clamp-1")).toBeNull();
    expect(screen.queryByText(description)).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    const again = button.querySelector(".line-clamp-1");
    expect(again).toHaveTextContent(description);
    expect(again).toHaveClass("group-focus-visible:line-clamp-none");
    expect(again?.className).not.toContain("group-hover:");
  });

  it("hides the description while the section starts open, and omits a blank one", () => {
    const { rerender } = render(
      <Disclosure title="MCP 服务器" description={description} defaultOpen bare>
        <p>服务器列表</p>
      </Disclosure>,
    );
    const open = screen.getByRole("button", { name: "MCP 服务器" });
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(open).toHaveClass("group");
    expect(open.querySelector(".line-clamp-1")).toBeNull();
    expect(screen.getByText("服务器列表")).toBeInTheDocument();

    fireEvent.click(open);
    const line = open.querySelector(".line-clamp-1");
    expect(line).toHaveTextContent(description);
    expect(line).toHaveClass("line-clamp-1", "group-focus-visible:line-clamp-none");
    expect(line?.className).not.toContain("group-hover:");

    rerender(
      <Disclosure title="LLM 配置" bare>
        <p>模型表单</p>
      </Disclosure>,
    );
    const plain = screen.getByRole("button", { name: "LLM 配置" });
    expect(plain.querySelector(".line-clamp-1")).toBeNull();
    expect(plain).toHaveClass("group", "focus-visible:ring-focus-ring");
  });
});
