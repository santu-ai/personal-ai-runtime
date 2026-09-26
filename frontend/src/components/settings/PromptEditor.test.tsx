import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";
import PromptEditor from "./PromptEditor";

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.promptConfig, {
    identity: "我是助手",
    coding_rules: "用中文写",
    is_custom_identity: true,
    is_custom_coding_rules: false,
  });
  return render(
    <QueryClientProvider client={client}>
      <PromptEditor />
    </QueryClientProvider>,
  );
}

describe("PromptEditor field names", () => {
  it("connects the identity and coding-rule names to their fields", () => {
    renderEditor();

    const identity = screen.getByRole("textbox", { name: /身份定义/ }) as HTMLTextAreaElement;
    expect(identity).toHaveValue("我是助手");
    expect(identity.labels?.[0]).toHaveAttribute("for", identity.id);
    expect(identity.labels?.[0]).toHaveTextContent("身份定义");
    expect(identity.labels?.[0]).toHaveTextContent("(已自定义)");

    const rules = screen.getByRole("textbox", { name: "代码规则" }) as HTMLTextAreaElement;
    expect(rules).toHaveValue("用中文写");
    expect(rules.labels?.[0]).toHaveAttribute("for", rules.id);
    expect(rules.labels?.[0]).not.toHaveTextContent("已自定义");
  });

  it("names 保存 and 重置 with the field and leaves the visible words unchanged", () => {
    renderEditor();

    const saveIdentity = screen.getByRole("button", { name: "保存：身份定义" });
    const resetIdentity = screen.getByRole("button", { name: "重置：身份定义" });
    const saveRules = screen.getByRole("button", { name: "保存：代码规则" });
    const resetRules = screen.getByRole("button", { name: "重置：代码规则" });

    expect(saveIdentity).toHaveTextContent("保存");
    expect(saveIdentity).not.toHaveTextContent("身份定义");
    expect(saveIdentity).toHaveAttribute("aria-label", "保存：身份定义");
    expect(saveIdentity.getAttribute("aria-label")).not.toContain("已自定义");

    expect(resetIdentity).toHaveTextContent("重置");
    expect(resetIdentity).toBeEnabled();
    expect(resetIdentity).toHaveAttribute("aria-label", "重置：身份定义");
    expect(resetIdentity.getAttribute("aria-label")).not.toContain("已自定义");

    expect(saveRules).toHaveTextContent("保存");
    expect(saveRules).toHaveAttribute("aria-label", "保存：代码规则");
    expect(resetRules).toHaveTextContent("重置");
    expect(resetRules).toBeDisabled();
    expect(resetRules).toHaveAttribute("aria-label", "重置：代码规则");

    expect(saveIdentity.getAttribute("aria-label")).not.toBe(saveRules.getAttribute("aria-label"));
    expect(resetIdentity.getAttribute("aria-label")).not.toBe(resetRules.getAttribute("aria-label"));
  });
});
