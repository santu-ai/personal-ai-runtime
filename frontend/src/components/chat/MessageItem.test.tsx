import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import MessageItem from "./MessageItem";

vi.mock("./LazyMarkdown", () => ({
  LazyMarkdown: ({
    content,
    components,
  }: {
    content: string;
    components?: React.ComponentProps<typeof ReactMarkdown>["components"];
  }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {content}
    </ReactMarkdown>
  ),
}));

describe("MessageItem", () => {
  it("renders user message with Chinese label", () => {
    render(
      <MessageItem
        message={{
          id: "m1",
          role: "user",
          content: "你好",
        }}
      />,
    );
    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByText("你")).toBeInTheDocument();
  });

  it("renders assistant markdown content", () => {
    render(
      <MessageItem
        message={{
          id: "m2",
          role: "assistant",
          content: "**加粗**文本",
        }}
      />,
    );
    expect(screen.getByText("加粗")).toBeInTheDocument();
  });

  it("does not render system messages", () => {
    const { container } = render(
      <MessageItem
        message={{
          id: "m3",
          role: "system",
          content: "hidden",
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("skips empty non-streaming assistant bubbles without tools", () => {
    const { container } = render(
      <MessageItem
        message={{
          id: "m4",
          role: "assistant",
          content: "   ",
        }}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("still renders empty assistant while streaming", () => {
    render(
      <MessageItem
        message={{
          id: "m5",
          role: "assistant",
          content: "",
          isStreaming: true,
        }}
      />,
    );
    expect(screen.getByLabelText("助手")).toBeInTheDocument();
  });

  it("shows thinking placeholder before first token", () => {
    render(
      <MessageItem
        message={{
          id: "m6",
          role: "assistant",
          content: "",
          isStreaming: true,
        }}
      />,
    );
    expect(screen.getByText("思考中…")).toBeInTheDocument();
  });

  it("does not show thinking placeholder once content streams in", () => {
    render(
      <MessageItem
        message={{
          id: "m7",
          role: "assistant",
          content: "你好",
          isStreaming: true,
        }}
      />,
    );
    expect(screen.queryByText("思考中…")).not.toBeInTheDocument();
    expect(screen.getByText("你好")).toBeInTheDocument();
  });

  it("does not show thinking placeholder when tools are running without text", () => {
    render(
      <MessageItem
        message={{
          id: "m8",
          role: "assistant",
          content: "",
          isStreaming: true,
          toolCalls: [{ index: 0, id: "tc1", function_name: "web_search", arguments: "{}" }],
        }}
      />,
    );
    expect(screen.queryByText("思考中…")).not.toBeInTheDocument();
  });

  it("opens http(s) markdown links in a new tab with noopener", () => {
    render(
      <MessageItem
        message={{
          id: "m9",
          role: "assistant",
          content: "[文档](https://example.com/docs)",
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "文档" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
  });

  it("routes same-origin markdown links inside the app", () => {
    render(
      <MemoryRouter>
        <MessageItem
          message={{
            id: "m9b",
            role: "assistant",
            content: "[任务](/tasks/brief%2F1)",
          }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "任务" });
    expect(link).toHaveAttribute("href", "/tasks/brief%2F1");
    expect(link).toHaveClass("focus-visible:ring-focus-ring");
    expect(link).not.toHaveAttribute("target");
  });

  it("does not render javascript: markdown links as anchors", () => {
    render(
      <MessageItem
        message={{
          id: "m10",
          role: "assistant",
          content: "[坏](javascript:alert(1))",
        }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("坏")).toBeInTheDocument();
  });

  it("shows the inline code copy button when keyboard focus lands on it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MessageItem
        message={{
          id: "m11",
          role: "assistant",
          content: "用 `echo hi` 试试",
        }}
      />,
    );
    const copy = screen.getByRole("button", { name: "复制" });
    expect(copy.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover:opacity-100",
        "focus-visible:opacity-100",
        "focus-visible:ring-focus-ring",
      ]),
    );
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("echo hi"));
    expect(screen.getByRole("button", { name: "已复制" })).toBe(copy);
  });

  it("does not mark inline code as copied when the clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MessageItem
        message={{
          id: "m12",
          role: "assistant",
          content: "用 `echo hi` 试试",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("echo hi"));
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已复制" })).not.toBeInTheDocument();
  });

  it("shows a keyboard-visible copy button on fenced code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MessageItem
        message={{
          id: "m13",
          role: "assistant",
          content: "```js\nconst x = 1\n```",
        }}
      />,
    );
    const copy = screen.getByRole("button", { name: "复制" });
    expect(copy).toHaveAttribute("data-code-block-copy", "");
    expect(copy.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover:opacity-100",
        "focus-visible:opacity-100",
        "focus-visible:ring-focus-ring",
      ]),
    );
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1"));
    expect(screen.getByRole("button", { name: "已复制" })).toBe(copy);
  });

  it("copies an unlabeled fenced block without the trailing newline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MessageItem
        message={{
          id: "m14",
          role: "assistant",
          content: "```\necho hi\n```",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("echo hi"));
    expect(screen.getByRole("button", { name: "已复制" })).toHaveAttribute(
      "data-code-block-copy",
      "",
    );
  });

  it("does not mark fenced code as copied when the clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MessageItem
        message={{
          id: "m15",
          role: "assistant",
          content: "```js\nconst x = 1\n```",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1"));
    expect(screen.getByRole("button", { name: "复制" })).toHaveAttribute(
      "data-code-block-copy",
      "",
    );
    expect(screen.queryByRole("button", { name: "已复制" })).not.toBeInTheDocument();
  });
});
