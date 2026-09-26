import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LlmSettingsResponse } from "../../api/settings";
import LlmConfigCard from "./LlmConfigCard";

const llm: LlmSettingsResponse = {
  config: {
    default_provider: "deepseek",
    temperature: 0.7,
    max_tokens: 4096,
    providers: [
      {
        id: "deepseek",
        name: "DeepSeek",
        type: "openai_compatible",
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        api_key: "",
        enabled: true,
      },
    ],
  },
  default_model: "deepseek-chat",
  providers_status: [],
  presets: {},
  provider_types: {},
};

function expectNamed(name: string) {
  const field = screen.getByLabelText(name);
  const label = screen.getByText(name);
  expect(label.tagName).toBe("LABEL");
  expect(label).toHaveAttribute("for", field.id);
  return field;
}

describe("LlmConfigCard field names", () => {
  it("connects each visible name to its field", () => {
    render(<LlmConfigCard llm={llm} onSaved={() => {}} embedded />);

    expect(expectNamed("默认 Provider")).toHaveValue("deepseek");
    expect(expectNamed("Temperature")).toHaveValue(0.7);
    expect(expectNamed("Max Tokens")).toHaveValue(4096);
    expect(expectNamed("ID")).toHaveValue("deepseek");
    expect(expectNamed("显示名称")).toHaveValue("DeepSeek");
    expect(expectNamed("类型")).toHaveValue("openai_compatible");
    expect(expectNamed("模型")).toHaveValue("deepseek-chat");
    expect(screen.getByLabelText("模型")).toHaveAttribute(
      "placeholder",
      "deepseek-chat / gpt-4o / qwen2.5:7b",
    );
    expect(expectNamed("Base URL")).toHaveValue("https://api.deepseek.com/v1");
    const apiKey = expectNamed("API Key");
    expect(apiKey).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "显示密码" })).not.toBe(apiKey);
  });
});
