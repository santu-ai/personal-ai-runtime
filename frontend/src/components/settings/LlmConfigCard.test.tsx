import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LlmProviderConfig, LlmSettingsResponse } from "../../api/settings";
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

function expectNamed(accessible: string, visible = accessible) {
  const field = screen.getByLabelText(accessible);
  const label = screen.getByText(visible);
  expect(label.tagName).toBe("LABEL");
  expect(label).toHaveAttribute("for", field.id);
  return field;
}

function provider(partial: Partial<LlmProviderConfig> & { id: string }): LlmProviderConfig {
  return {
    name: "",
    type: "openai_compatible",
    base_url: "https://example.invalid/v1",
    model: "secret-model",
    api_key: "",
    enabled: true,
    ...partial,
  };
}

function settings(
  providers: LlmProviderConfig[],
  presets: LlmSettingsResponse["presets"] = {},
): LlmSettingsResponse {
  return {
    config: {
      default_provider: providers[0]?.id ?? "",
      temperature: 0.7,
      max_tokens: 4096,
      providers,
    },
    default_model: "deepseek-chat",
    providers_status: [],
    presets,
    provider_types: {},
  };
}

describe("LlmConfigCard field names", () => {
  it("connects each visible name to its field", () => {
    render(<LlmConfigCard llm={llm} onSaved={() => {}} embedded />);

    expect(expectNamed("默认 Provider")).toHaveValue("deepseek");
    expect(expectNamed("Temperature")).toHaveValue(0.7);
    expect(expectNamed("Max Tokens")).toHaveValue(4096);
    expect(expectNamed("ID：DeepSeek", "ID")).toHaveValue("deepseek");
    expect(expectNamed("显示名称：DeepSeek", "显示名称")).toHaveValue("DeepSeek");
    expect(expectNamed("类型：DeepSeek", "类型")).toHaveValue("openai_compatible");
    expect(expectNamed("模型：DeepSeek", "模型")).toHaveValue("deepseek-chat");
    expect(screen.getByLabelText("模型：DeepSeek")).toHaveAttribute(
      "placeholder",
      "deepseek-chat / gpt-4o / qwen2.5:7b",
    );
    expect(expectNamed("Base URL：DeepSeek", "Base URL")).toHaveValue(
      "https://api.deepseek.com/v1",
    );
    const apiKey = expectNamed("API Key：DeepSeek", "API Key");
    expect(apiKey).toHaveAttribute("type", "password");
    const reveal = screen.getByRole("button", { name: "显示密码：DeepSeek" });
    expect(reveal).not.toBe(apiKey);
    expect(reveal).toHaveTextContent("显示密码");
    expect(reveal).not.toHaveTextContent("DeepSeek");
    expect(screen.getByRole("button", { name: "测试：DeepSeek" })).toHaveTextContent("测试");
    expect(screen.getByRole("checkbox", { name: "启用此 Provider：DeepSeek" })).toBeChecked();
    expect(screen.getByText("启用此 Provider")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加 Provider" })).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("button", { name: "保存 LLM 配置" })).not.toHaveAttribute("aria-label");
  });

  it("appends this provider to repeated controls and leaves the shared fields bare", () => {
    render(
      <LlmConfigCard
        llm={settings(
          [
            provider({
              id: "deepseek",
              name: "  前  后  ",
              model: "deepseek-chat",
              base_url: "https://api.deepseek.com/v1",
              api_key: "••••••••",
              has_api_key: true,
            }),
            provider({
              id: "ollama",
              name: "前一段\n后一段",
              type: "ollama",
              model: "qwen",
              base_url: "http://127.0.0.1:11434/v1",
            }),
            provider({
              id: "  same  ",
              name: "  前  后  ",
              model: "other-model",
            }),
            provider({
              id: "  bare-id  ",
              name: " \n ",
              model: "from-id",
            }),
            provider({
              id: " \n ",
              name: "   ",
              model: "unnamed-model",
              base_url: "https://blank.invalid",
            }),
          ],
          {
            official: { name: "  官方  ", type: "openai_compatible", base_url: "", model: "" },
            blank: { name: "   ", type: "openai_compatible", base_url: "", model: "" },
          },
        )}
        onSaved={() => {}}
        embedded
      />,
    );

    function cardForModel(model: string): HTMLElement {
      const card = screen.getByDisplayValue(model).closest("div.border");
      if (!(card instanceof HTMLElement)) throw new Error(`missing card for ${model}`);
      return card;
    }

    function buttonWithText(card: HTMLElement, text: string): HTMLButtonElement {
      const button = [...card.querySelectorAll("button")].find(
        (node) => node.textContent?.trim() === text,
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error(text);
      return button;
    }

    function labelled(card: HTMLElement, visible: string): HTMLElement {
      const label = within(card).getByText(visible);
      const id = label.getAttribute("for");
      const control = id ? document.getElementById(id) : null;
      if (!(control instanceof HTMLElement)) throw new Error(visible);
      return control;
    }

    const spaced = cardForModel("deepseek-chat");
    const broken = cardForModel("qwen");
    const duplicate = cardForModel("other-model");
    const byId = cardForModel("from-id");
    const bareCard = cardForModel("unnamed-model");

    for (const card of [spaced, duplicate]) {
      const test = buttonWithText(card, "测试");
      expect(test).toHaveAttribute("aria-label", "测试：前  后");
      expect(test.textContent).not.toMatch(/deepseek-chat|other-model|api\.deepseek/);
      expect(buttonWithText(card, "删除")).toHaveAttribute("aria-label", "删除：前  后");
      expect(within(card).getByRole("checkbox")).toHaveAttribute(
        "aria-label",
        "启用此 Provider：前  后",
      );
      expect(labelled(card, "模型")).toHaveAttribute("aria-label", "模型：前  后");
    }
    expect(buttonWithText(broken, "测试")).toHaveAttribute("aria-label", "测试：前一段\n后一段");
    expect(buttonWithText(broken, "删除")).toHaveAttribute("aria-label", "删除：前一段\n后一段");
    expect(labelled(broken, "模型")).toHaveAttribute("aria-label", "模型：前一段\n后一段");
    expect(labelled(broken, "模型")).toHaveValue("qwen");
    expect(buttonWithText(byId, "测试")).toHaveAttribute("aria-label", "测试：bare-id");
    expect(buttonWithText(byId, "删除")).toHaveAttribute("aria-label", "删除：bare-id");
    expect(labelled(byId, "模型")).toHaveAttribute("aria-label", "模型：bare-id");
    expect(buttonWithText(bareCard, "测试")).toHaveAttribute("aria-label", "测试");
    expect(buttonWithText(bareCard, "删除")).not.toHaveAttribute("aria-label");
    expect(within(bareCard).getByRole("checkbox", { name: "启用此 Provider" })).not.toHaveAttribute(
      "aria-label",
    );
    expect(labelled(bareCard, "模型")).not.toHaveAttribute("aria-label");
    expect(labelled(bareCard, "模型")).toHaveValue("unnamed-model");
    expect(screen.getAllByText("启用此 Provider").length).toBeGreaterThan(1);
    expect(screen.getByLabelText("默认 Provider")).not.toHaveAttribute("aria-label");
    expect(screen.getByLabelText("Temperature")).not.toHaveAttribute("aria-label");
    expect(screen.getByLabelText("Max Tokens")).not.toHaveAttribute("aria-label");

    const eye = buttonWithText(spaced, "显示密码");
    expect(eye).toHaveAttribute("aria-label", "显示密码：前  后");
    expect(eye).toHaveAttribute("title", "已保存的密钥无法查看原文");
    expect(eye.getAttribute("title")).not.toMatch(/前 {2}后|deepseek/);
    fireEvent.click(eye);
    const hidden = buttonWithText(spaced, "隐藏密码");
    expect(hidden).toHaveAttribute("aria-label", "隐藏密码：前  后");

    expect(buttonWithText(bareCard, "显示密码")).toHaveAttribute("aria-label", "显示密码");
    const spacedPresets = [...spaced.querySelectorAll(".flex.gap-2.flex-wrap button")];
    expect(spacedPresets[0]).toHaveAttribute("aria-label", "官方：前  后");
    expect(spacedPresets[0]?.textContent).toContain("  官方  ");
    expect(spacedPresets[1]).toHaveAttribute("aria-label", "blank：前  后");
    expect(spacedPresets[1]?.textContent).toContain("   ");
    const barePresets = [...bareCard.querySelectorAll(".flex.gap-2.flex-wrap button")];
    expect(barePresets[0]).not.toHaveAttribute("aria-label");
    expect(barePresets[0]?.textContent).toContain("  官方  ");
  });
});
