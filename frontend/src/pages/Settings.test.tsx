import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within, act } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import SettingsPage from "./Settings";
import {
  ApiError,
  getCapabilityPolicy,
  getLlmSettings,
  getMcpStatus,
  getPromptConfig,
  testEmailConnection,
  testLlmConnection,
  updateEmailSettings,
  updateLlmSettings,
  updatePromptConfig,
} from "../api/client";
import { installMcpConnector, listMcpRegistry } from "../api/connectors";
import {
  getTelegramGatewayStatus,
  pollTelegramGateway,
  updateTelegramGateway,
  type TelegramGatewayStatus,
} from "../api/settings";

vi.mock("../api/client", () => ({
  getSystemHealth: vi.fn().mockResolvedValue({
    status: "ok",
    service: "personal-ai-runtime",
    auth_required: false,
    startup: {
      status: "ok",
      warning_count: 0,
      checks: {
        mcp: { total: 1, connected: 1, failed: 0 },
      },
    },
  }),
  getMcpStatus: vi.fn().mockResolvedValue({
    enabled: true,
    servers: [
      {
        name: "email",
        status: "connected",
        tool_count: 3,
        startup_connect: true,
      },
    ],
    total_tools: 3,
  }),
  getLlmSettings: vi.fn().mockResolvedValue({
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
          api_key: "••••••••",
          has_api_key: true,
          enabled: true,
        },
      ],
    },
    default_model: "deepseek-chat",
    providers_status: [
      {
        name: "deepseek",
        model: "deepseek-chat",
        type: "openai_compatible",
        is_default: true,
        available: true,
      },
    ],
    presets: {
      deepseek: {
        name: "DeepSeek",
        type: "openai_compatible",
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      },
    },
    provider_types: { openai_compatible: "OpenAI 兼容" },
  }),
  updateLlmSettings: vi.fn(),
  testLlmConnection: vi.fn(),
  getEmailSettings: vi.fn().mockResolvedValue({
    config: {
      provider: "gmail",
      user: "test@gmail.com",
      password: "••••••••",
      imap_host: "imap.gmail.com",
      smtp_host: "smtp.gmail.com",
      smtp_port: 465,
      configured: true,
    },
    provider: "gmail",
    help: "使用 Gmail 应用专用密码",
  }),
  updateEmailSettings: vi.fn(),
  testEmailConnection: vi.fn(),
  getPromptConfig: vi.fn().mockResolvedValue({
    identity: "test identity",
    coding_rules: "test rules",
    is_custom_identity: false,
    is_custom_coding_rules: false,
  }),
  updatePromptConfig: vi.fn().mockResolvedValue({ ok: true }),
  getCapabilityPolicy: vi.fn().mockResolvedValue({
    auto_allow: ["read_file", "web_search"],
    needs_user: ["write_file", "send_email"],
    forbidden: [],
    external_ingestion: ["web_search"],
  }),
  downloadExport: vi.fn().mockResolvedValue(undefined),
  importData: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../api/connectors", () => ({
  listMcpRegistry: vi.fn().mockResolvedValue([]),
  installMcpConnector: vi.fn(),
}));

vi.mock("../api/settings", () => ({
  getTelegramGatewayStatus: vi.fn().mockResolvedValue({
    enabled: false,
    auto_reply: false,
    token_configured: true,
    chat_configured: true,
    capability_enabled: true,
    connected: false,
    last_update_id: 0,
    last_error: "",
    last_polled_at: "",
    last_sent_at: "",
  }),
  updateTelegramGateway: vi.fn(),
  pollTelegramGateway: vi.fn(),
}));

const { addError } = vi.hoisted(() => ({
  addError: vi.fn(),
}));

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: typeof addError }) => unknown) =>
    selector({ addError }),
}));

const telegramStatus: TelegramGatewayStatus = {
  enabled: false,
  auto_reply: false,
  token_configured: true,
  chat_configured: true,
  capability_enabled: true,
  connected: false,
  last_update_id: 0,
  last_error: "",
  last_polled_at: "",
  last_sent_at: "",
};

async function expandSection(title: string) {
  const trigger = await screen.findByRole("button", { name: new RegExp(title) });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMcpRegistry).mockResolvedValue([]);
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "test identity",
      coding_rules: "test rules",
      is_custom_identity: false,
      is_custom_coding_rules: false,
    });
    vi.mocked(getMcpStatus).mockResolvedValue({
      enabled: true,
      servers: [
        {
          name: "email",
          status: "connected",
          tool_count: 3,
          startup_connect: true,
        },
      ],
      total_tools: 3,
    });
    vi.mocked(getTelegramGatewayStatus).mockResolvedValue(telegramStatus);
  });

  it("renders header, status badge and export button", async () => {
    renderWithRouter(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("设置")).toBeInTheDocument();
    });
    expect(screen.getByText("运行正常")).toBeInTheDocument();

    await expandSection("数据主权");
    expect(await screen.findByText("导出全部数据")).toBeInTheDocument();
  });

  it("shows editable LLM and Gmail config sections", async () => {
    renderWithRouter(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Gmail 邮箱配置")).toBeInTheDocument();
    });
    // LLM is defaultOpen
    expect(screen.getByText("保存 LLM 配置")).toBeInTheDocument();
    const llm = screen.getByRole("region", { name: "LLM 配置" });
    const selects = within(llm).getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toHaveClass("focus-visible:ring-focus-ring");
    }

    await expandSection("Gmail 邮箱配置");
    expect(await screen.findByText("保存邮箱配置")).toBeInTheDocument();
    expect(screen.getByText("测试连接")).toBeInTheDocument();
  });

  it("shows Telegram gateway controls without credentials", async () => {
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    expect(await screen.findByText("启用每分钟本地轮询")).toBeInTheDocument();
    expect(screen.getByText("Token 已配置 · Chat ID 已配置")).toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  it("renders capability policy tools from API", async () => {
    renderWithRouter(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("AI 能力与信任")).toBeInTheDocument();
    });
    await expandSection("AI 能力与信任");
    await waitFor(() => {
      expect(screen.getByText("读取文件")).toBeInTheDocument();
      expect(screen.getByText("写入文件")).toBeInTheDocument();
      expect(screen.getByText("发送邮件")).toBeInTheDocument();
    });
  });

  it("shows an empty MCP registry after a successful read", async () => {
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    expect(await screen.findByText("暂无可用 MCP 服务器")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-registry-load-error")).not.toBeInTheDocument();
  });

  it("shows a retry when the MCP registry fails to load", async () => {
    vi.mocked(listMcpRegistry).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    const alert = await screen.findByTestId("mcp-registry-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(screen.queryByText("暂无可用 MCP 服务器")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("shows an empty MCP server list when none are enabled", async () => {
    vi.mocked(getMcpStatus).mockResolvedValue({
      enabled: true,
      servers: [],
      total_tools: 0,
    });
    renderWithRouter(<SettingsPage />);
    expect(await screen.findByText("暂无 MCP 服务器")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-status-load-error")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP 未启用或连接信息不可用")).not.toBeInTheDocument();
  });

  it("shows a retry when MCP status fails to load", async () => {
    vi.mocked(getMcpStatus).mockRejectedValue(new ApiError("   ", 500));
    renderWithRouter(<SettingsPage />);
    const alert = await screen.findByTestId("mcp-status-load-error", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("加载 MCP 服务器失败");
    expect(screen.queryByText("暂无 MCP 服务器")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP 未启用或连接信息不可用")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("shows a retry when Telegram status fails to load", async () => {
    vi.mocked(getTelegramGatewayStatus).mockRejectedValue(new ApiError("网关暂时读不到", 503));
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const alert = await screen.findByTestId("telegram-load-error");
    expect(alert).toHaveTextContent("网关暂时读不到");
    expect(screen.queryByText("加载 Telegram 状态…")).not.toBeInTheDocument();
    expect(screen.queryByText("启用每分钟本地轮询")).not.toBeInTheDocument();
    const retry = within(alert).getByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
  });

  it("uses the Telegram fallback when the status error has no message", async () => {
    vi.mocked(getTelegramGatewayStatus).mockRejectedValue(new ApiError("   ", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    expect(await screen.findByTestId("telegram-load-error")).toHaveTextContent(
      "加载 Telegram 状态失败",
    );
    expect(screen.queryByText("加载 Telegram 状态…")).not.toBeInTheDocument();
  });

  it("keeps the Telegram retry until the reread finishes", async () => {
    let release: ((row: TelegramGatewayStatus) => void) | undefined;
    vi.mocked(getTelegramGatewayStatus)
      .mockRejectedValueOnce(new ApiError("网关暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const retry = await screen.findByRole("button", { name: "重试" });
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("telegram-load-error")).toHaveTextContent("网关暂时读不到");
    expect(screen.queryByText("加载 Telegram 状态…")).not.toBeInTheDocument();

    release?.(telegramStatus);
    expect(await screen.findByText("启用每分钟本地轮询")).toBeInTheDocument();
    expect(screen.queryByTestId("telegram-load-error")).not.toBeInTheDocument();
  });

  it("shows a retry when saved settings fail to load", async () => {
    vi.mocked(getLlmSettings).mockRejectedValueOnce(new ApiError("配置暂时读不到", 503));
    renderWithRouter(<SettingsPage />);
    const alert = await screen.findByTestId("settings-core-load-error");
    expect(alert).toHaveTextContent("配置暂时读不到");
    expect(screen.queryByText("加载设置…")).not.toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("uses the settings fallback when the config error has no message", async () => {
    vi.mocked(getLlmSettings).mockRejectedValueOnce(new ApiError("   ", 500));
    renderWithRouter(<SettingsPage />);
    expect(await screen.findByTestId("settings-core-load-error")).toHaveTextContent(
      "无法加载已保存的配置",
    );
    expect(screen.queryByText("加载设置…")).not.toBeInTheDocument();
  });

  it("keeps the settings retry until the reread finishes", async () => {
    let release: ((row: Awaited<ReturnType<typeof getLlmSettings>>) => void) | undefined;
    vi.mocked(getLlmSettings)
      .mockRejectedValueOnce(new ApiError("配置暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    renderWithRouter(<SettingsPage />);
    const retry = await screen.findByRole("button", { name: "重试" });
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByTestId("settings-core-load-error")).toHaveTextContent("配置暂时读不到");
    expect(screen.queryByText("加载设置…")).not.toBeInTheDocument();

    release?.({
      config: {
        default_provider: "deepseek",
        temperature: 0.7,
        max_tokens: 4096,
        providers: [],
      },
      default_model: "deepseek-chat",
      providers_status: [],
      presets: {},
      provider_types: {},
    });
    expect(await screen.findByText("设置")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-core-load-error")).not.toBeInTheDocument();
  });

  it("shows a retry when the capability policy fails to load", async () => {
    vi.mocked(getCapabilityPolicy).mockRejectedValueOnce(new ApiError("策略暂时读不到", 503));
    renderWithRouter(<SettingsPage />);
    await expandSection("AI 能力与信任");
    const alert = await screen.findByTestId("capability-policy-load-error");
    expect(alert).toHaveTextContent("策略暂时读不到");
    expect(screen.queryByText("加载策略中…")).not.toBeInTheDocument();
    expect(screen.queryByText("加载失败，点击重试")).not.toBeInTheDocument();
    expect(screen.queryByText("（无）")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("uses the capability fallback when the policy error has no message", async () => {
    vi.mocked(getCapabilityPolicy).mockRejectedValueOnce(new ApiError("   ", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("AI 能力与信任");
    expect(await screen.findByTestId("capability-policy-load-error")).toHaveTextContent(
      "加载能力策略失败",
    );
    expect(screen.queryByText("加载策略中…")).not.toBeInTheDocument();
  });

  it("keeps the capability retry until the reread finishes", async () => {
    let release: ((row: Awaited<ReturnType<typeof getCapabilityPolicy>>) => void) | undefined;
    vi.mocked(getCapabilityPolicy)
      .mockRejectedValueOnce(new ApiError("策略暂时读不到", 503))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    renderWithRouter(<SettingsPage />);
    await expandSection("AI 能力与信任");
    const retry = await screen.findByRole("button", { name: "重试" });
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByTestId("capability-policy-load-error")).toHaveTextContent("策略暂时读不到");
    expect(screen.queryByText("加载策略中…")).not.toBeInTheDocument();

    release?.({
      auto_allow: ["read_file"],
      needs_user: [],
      forbidden: [],
      external_ingestion: [],
    });
    expect(await screen.findByText("读取文件")).toBeInTheDocument();
    expect(screen.queryByTestId("capability-policy-load-error")).not.toBeInTheDocument();
  });

  it("shows a retry when the prompt config fails to load", async () => {
    vi.mocked(getPromptConfig).mockRejectedValue(new ApiError("加载失败", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const alert = await screen.findByTestId("prompt-load-error");
    expect(alert).toHaveTextContent("加载失败");
    expect(
      screen.queryByPlaceholderText("定义 AI 的身份、性格、行为准则..."),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());
  });

  it("shows that the LLM config was saved and clears it after another edit", async () => {
    vi.mocked(updateLlmSettings).mockResolvedValueOnce({
      config: {
        default_provider: "deepseek",
        temperature: 0.7,
        max_tokens: 4096,
        providers: [],
      },
      default_model: "deepseek-chat",
      providers_status: [],
      presets: {},
      provider_types: {},
    });
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByTestId("llm-save-notice")).toHaveTextContent("已保存");
    expect(save).toHaveFocus();

    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), {
      target: { value: "deepseek-reasoner" },
    });
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-reasoner")).toBeInTheDocument();
  });

  it("keeps the LLM form and focus on 保存 LLM 配置 when saving fails", async () => {
    vi.mocked(updateLlmSettings).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("写不进去", "设置"));
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-chat")).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not save the LLM config twice and keeps focus on 保存 LLM 配置", async () => {
    let release: ((row: Awaited<ReturnType<typeof updateLlmSettings>>) => void) | undefined;
    vi.mocked(updateLlmSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(updateLlmSettings).toHaveBeenCalledTimes(1);
    expect(save).toHaveTextContent("保存中…");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();

    await act(async () => {
      release?.({
        config: {
          default_provider: "deepseek",
          temperature: 0.7,
          max_tokens: 4096,
          providers: [],
        },
        default_model: "deepseek-chat",
        providers_status: [],
        presets: {},
        provider_types: {},
      });
    });
    expect(await screen.findByTestId("llm-save-notice")).toHaveTextContent("已保存");
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not say the LLM config was saved if the form changes before the response", async () => {
    let release: ((row: Awaited<ReturnType<typeof updateLlmSettings>>) => void) | undefined;
    vi.mocked(updateLlmSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    const field = screen.getByDisplayValue("0.7");
    save.focus();
    fireEvent.click(save);
    field.focus();
    fireEvent.change(field, { target: { value: "0.2" } });
    await act(async () => {
      release?.({
        config: {
          default_provider: "deepseek",
          temperature: 0.7,
          max_tokens: 4096,
          providers: [],
        },
        default_model: "deepseek-chat",
        providers_status: [],
        presets: {},
        provider_types: {},
      });
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(field).toHaveValue(0.2);
    expect(field).toHaveFocus();
  });

  it("shows a successful LLM connection test and clears it after that provider changes", async () => {
    vi.mocked(testLlmConnection).mockResolvedValueOnce({ ok: true, provider: "deepseek" });
    renderWithRouter(<SettingsPage />);
    const test = await screen.findByRole("button", { name: "测试" });
    fireEvent.click(test);
    expect(await screen.findByTestId("llm-test-ok-deepseek")).toHaveTextContent("连接正常");

    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), {
      target: { value: "deepseek-reasoner" },
    });
    expect(screen.queryByTestId("llm-test-ok-deepseek")).not.toBeInTheDocument();
  });

  it("does not mark the LLM connection ok when the test fails", async () => {
    vi.mocked(testLlmConnection).mockResolvedValueOnce({
      ok: false,
      provider: "deepseek",
      error: "超时",
    });
    renderWithRouter(<SettingsPage />);
    const test = await screen.findByRole("button", { name: "测试" });
    test.focus();
    fireEvent.click(test);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("超时", "LLM"));
    expect(test).toBeEnabled();
    expect(test).toHaveFocus();
    expect(test).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("连接正常")).not.toBeInTheDocument();
  });

  it("does not test one LLM provider twice and keeps focus on 测试", async () => {
    let release: ((row: Awaited<ReturnType<typeof testLlmConnection>>) => void) | undefined;
    vi.mocked(testLlmConnection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.mocked(getLlmSettings).mockResolvedValueOnce({
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
            api_key: "••••••••",
            has_api_key: true,
            enabled: true,
          },
          {
            id: "ollama",
            name: "Ollama",
            type: "ollama",
            base_url: "http://127.0.0.1:11434/v1",
            model: "qwen2.5:7b",
            api_key: "",
            has_api_key: false,
            enabled: true,
          },
        ],
      },
      default_model: "deepseek-chat",
      providers_status: [],
      presets: {},
      provider_types: {},
    });
    renderWithRouter(<SettingsPage />);
    await waitFor(() => {
      expect(document.querySelectorAll('button[data-llm-action="test"]')).toHaveLength(2);
    });
    const deepseek = document.querySelector<HTMLButtonElement>(
      'button[data-llm-provider="deepseek"]',
    );
    const other = document.querySelector<HTMLButtonElement>('button[data-llm-provider="ollama"]');
    if (!deepseek || !other) throw new Error("missing LLM test buttons");
    deepseek.focus();
    fireEvent.click(deepseek);
    fireEvent.click(deepseek);
    fireEvent.click(other);
    await waitFor(() => expect(deepseek).toHaveAttribute("aria-busy", "true"));
    expect(testLlmConnection).toHaveBeenCalledTimes(1);
    expect(testLlmConnection).toHaveBeenCalledWith("deepseek");
    expect(deepseek).toBeEnabled();
    expect(deepseek).toHaveFocus();
    expect(deepseek).toHaveTextContent("测试中…");
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");
    expect(other).toHaveTextContent("测试");

    await act(async () => {
      release?.({ ok: true, provider: "deepseek" });
    });
    expect(await screen.findByTestId("llm-test-ok-deepseek")).toHaveTextContent("连接正常");
    expect(deepseek).toHaveFocus();
    expect(deepseek).not.toHaveAttribute("aria-busy");
  });

  it("does not mark the LLM connection ok if that provider changes before the test returns", async () => {
    let release: ((row: Awaited<ReturnType<typeof testLlmConnection>>) => void) | undefined;
    vi.mocked(testLlmConnection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    const test = await screen.findByRole("button", { name: "测试" });
    const field = screen.getByDisplayValue("deepseek-chat");
    test.focus();
    fireEvent.click(test);
    fireEvent.click(test);
    expect(testLlmConnection).toHaveBeenCalledTimes(1);
    field.focus();
    fireEvent.change(field, { target: { value: "other-model" } });
    await act(async () => {
      release?.({ ok: true, provider: "deepseek" });
    });
    await waitFor(() => expect(test).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByText("连接正常")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("shows that the email config was saved and clears it after another edit", async () => {
    vi.mocked(updateEmailSettings).mockResolvedValueOnce({
      config: {
        provider: "gmail",
        user: "test@gmail.com",
        password: "••••••••",
        imap_host: "imap.gmail.com",
        smtp_host: "smtp.gmail.com",
        smtp_port: 465,
        configured: true,
      },
    });
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const save = await screen.findByRole("button", { name: "保存邮箱配置" });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByTestId("email-save-notice")).toHaveTextContent("已保存");
    expect(save).toHaveFocus();

    fireEvent.change(screen.getByDisplayValue("test@gmail.com"), {
      target: { value: "other@gmail.com" },
    });
    expect(screen.queryByTestId("email-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("other@gmail.com")).toBeInTheDocument();
  });

  it("keeps the email form and focus on 保存邮箱配置 when saving fails", async () => {
    vi.mocked(updateEmailSettings).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const save = await screen.findByRole("button", { name: "保存邮箱配置" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("写不进去", "设置"));
    expect(screen.queryByTestId("email-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("test@gmail.com")).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not save the email config twice and keeps focus on 保存邮箱配置", async () => {
    let release: ((row: Awaited<ReturnType<typeof updateEmailSettings>>) => void) | undefined;
    vi.mocked(updateEmailSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const save = await screen.findByRole("button", { name: "保存邮箱配置" });
    const test = screen.getByRole("button", { name: "测试连接" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(updateEmailSettings).toHaveBeenCalledTimes(1);
    expect(save).toHaveTextContent("保存中…");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(test).toBeEnabled();
    expect(test).not.toHaveAttribute("aria-busy");

    await act(async () => {
      release?.({
        config: {
          provider: "gmail",
          user: "test@gmail.com",
          password: "••••••••",
          imap_host: "imap.gmail.com",
          smtp_host: "smtp.gmail.com",
          smtp_port: 465,
          configured: true,
        },
      });
    });
    expect(await screen.findByTestId("email-save-notice")).toHaveTextContent("已保存");
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not steal focus when the email form changes before save returns", async () => {
    let release: ((row: Awaited<ReturnType<typeof updateEmailSettings>>) => void) | undefined;
    vi.mocked(updateEmailSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const save = await screen.findByRole("button", { name: "保存邮箱配置" });
    const field = screen.getByDisplayValue("test@gmail.com");
    save.focus();
    fireEvent.click(save);
    field.focus();
    fireEvent.change(field, { target: { value: "other@gmail.com" } });
    await act(async () => {
      release?.({
        config: {
          provider: "gmail",
          user: "test@gmail.com",
          password: "••••••••",
          imap_host: "imap.gmail.com",
          smtp_host: "smtp.gmail.com",
          smtp_port: 465,
          configured: true,
        },
      });
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByTestId("email-save-notice")).not.toBeInTheDocument();
    expect(field).toHaveValue("other@gmail.com");
    expect(field).toHaveFocus();
  });

  function promptControl(field: "identity" | "coding_rules", action: "save" | "reset") {
    const region = screen.getByRole("region", { name: "系统人设" });
    const node = region.querySelector<HTMLButtonElement>(
      `[data-prompt-field="${field}"][data-prompt-action="${action}"]`,
    );
    if (!node) throw new Error(`missing prompt ${field} ${action}`);
    return node;
  }

  it("does not save the persona twice and keeps focus on 保存", async () => {
    let release: (row: { ok: boolean }) => void = () => {};
    vi.mocked(updatePromptConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const field = await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    expect(field).toHaveClass("focus-visible:ring-focus-ring");
    expect(screen.getByPlaceholderText("定义 AI 编码时的行为规则...")).toHaveClass(
      "focus-visible:ring-focus-ring",
    );
    expect(field).toHaveValue("test identity");
    const save = promptControl("identity", "save");
    const other = promptControl("coding_rules", "save");
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(other);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).toHaveTextContent("保存中…");
    expect(other).not.toHaveAttribute("aria-busy");
    expect(updatePromptConfig).toHaveBeenCalledTimes(1);
    expect(updatePromptConfig).toHaveBeenCalledWith({ identity: "test identity" });

    await act(async () => {
      release({ ok: true });
    });
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("keeps a persona edit typed during save and skips 已保存", async () => {
    let release: (row: { ok: boolean }) => void = () => {};
    vi.mocked(updatePromptConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const field = await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    const save = promptControl("identity", "save");
    save.focus();
    fireEvent.click(save);
    field.focus();
    fireEvent.change(field, { target: { value: "还在改" } });
    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(field).toHaveValue("还在改");
    expect(field).toHaveFocus();
  });

  it("keeps 保存 focused when persona save fails", async () => {
    vi.mocked(updatePromptConfig).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    const save = promptControl("identity", "save");
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not reset the persona twice and then focuses that field", async () => {
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "自定义身份",
      coding_rules: "test rules",
      is_custom_identity: true,
      is_custom_coding_rules: false,
    });
    let release: (row: { ok: boolean }) => void = () => {};
    vi.mocked(updatePromptConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const field = await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    await waitFor(() => expect(field).toHaveValue("自定义身份"));
    const reset = promptControl("identity", "reset");
    const save = promptControl("identity", "save");
    const other = promptControl("coding_rules", "save");
    reset.focus();
    fireEvent.click(reset);
    fireEvent.click(reset);
    fireEvent.click(save);
    fireEvent.click(other);
    await waitFor(() => expect(reset).toHaveAttribute("aria-busy", "true"));
    expect(reset).toBeEnabled();
    expect(reset).toHaveFocus();
    expect(updatePromptConfig).toHaveBeenCalledTimes(1);
    expect(updatePromptConfig).toHaveBeenCalledWith({ identity: "" });

    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "默认身份",
      coding_rules: "test rules",
      is_custom_identity: false,
      is_custom_coding_rules: false,
    });
    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!reset.disabled) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(reset, { attributes: true, attributeFilter: ["disabled"] });
    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(field).toHaveValue("默认身份"));
    expect(focusWhenDisabled).toBe(field);
    expect(screen.getByText("已重置为默认")).toBeInTheDocument();
    expect(reset).toBeDisabled();
    expect(field).toHaveFocus();
    observer.disconnect();
  });

  it("does not overwrite a persona edit that arrives before reset returns", async () => {
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "自定义身份",
      coding_rules: "test rules",
      is_custom_identity: true,
      is_custom_coding_rules: false,
    });
    let release: (row: { ok: boolean }) => void = () => {};
    vi.mocked(updatePromptConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const field = await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    await waitFor(() => expect(field).toHaveValue("自定义身份"));
    const reset = promptControl("identity", "reset");
    reset.focus();
    fireEvent.click(reset);
    field.focus();
    fireEvent.change(field, { target: { value: "先别覆盖" } });
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "默认身份",
      coding_rules: "test rules",
      is_custom_identity: false,
      is_custom_coding_rules: false,
    });
    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(reset).not.toHaveAttribute("aria-busy"));
    expect(field).toHaveValue("先别覆盖");
    expect(screen.queryByText("已重置为默认")).not.toBeInTheDocument();
    expect(reset).toBeEnabled();
    expect(field).toHaveFocus();
  });

  it("does not steal focus after persona reset when it already moved", async () => {
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "自定义身份",
      coding_rules: "test rules",
      is_custom_identity: true,
      is_custom_coding_rules: false,
    });
    let release: (row: { ok: boolean }) => void = () => {};
    vi.mocked(updatePromptConfig).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("系统人设");
    const field = await screen.findByPlaceholderText("定义 AI 的身份、性格、行为准则...");
    const other = await screen.findByPlaceholderText("定义 AI 编码时的行为规则...");
    await waitFor(() => expect(field).toHaveValue("自定义身份"));
    const reset = promptControl("identity", "reset");
    reset.focus();
    fireEvent.click(reset);
    other.focus();
    vi.mocked(getPromptConfig).mockResolvedValue({
      identity: "默认身份",
      coding_rules: "test rules",
      is_custom_identity: false,
      is_custom_coding_rules: false,
    });
    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(field).toHaveValue("默认身份"));
    expect(other).toHaveFocus();
  });

  it("does not save telegram twice and keeps focus on 保存", async () => {
    let release: (row: TelegramGatewayStatus) => void = () => {};
    vi.mocked(updateTelegramGateway).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const save = await screen.findByRole("button", { name: "保存" });
    const poll = screen.getByRole("button", { name: "立即轮询" });
    expect(poll).toBeDisabled();
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(poll);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).toHaveTextContent("保存中…");
    expect(poll).not.toHaveAttribute("aria-busy");
    expect(updateTelegramGateway).toHaveBeenCalledTimes(1);
    expect(pollTelegramGateway).not.toHaveBeenCalled();

    await act(async () => {
      release({ ...telegramStatus, enabled: false });
    });
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(save).toHaveFocus();
  });

  it("skips 已保存 when a telegram switch changes before save returns", async () => {
    let release: (row: TelegramGatewayStatus) => void = () => {};
    vi.mocked(updateTelegramGateway).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const save = await screen.findByRole("button", { name: "保存" });
    const toggle = screen.getByRole("checkbox", { name: "启用每分钟本地轮询" });
    save.focus();
    fireEvent.click(save);
    toggle.focus();
    fireEvent.click(toggle);
    await act(async () => {
      release({ ...telegramStatus, enabled: false });
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(toggle).toHaveFocus();
  });

  it("keeps telegram 保存 focused when save fails", async () => {
    vi.mocked(updateTelegramGateway).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const save = await screen.findByRole("button", { name: "保存" });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText("写不进去")).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
  });

  it("does not poll telegram twice and moves focus to 保存 after the switch is turned off", async () => {
    let release: (row: { status: string; processed: number }) => void = () => {};
    vi.mocked(pollTelegramGateway).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const toggle = await screen.findByRole("checkbox", { name: "启用每分钟本地轮询" });
    fireEvent.click(toggle);
    const poll = screen.getByRole("button", { name: "立即轮询" });
    const save = screen.getByRole("button", { name: "保存" });
    expect(poll).toBeEnabled();
    poll.focus();
    fireEvent.click(poll);
    fireEvent.click(poll);
    fireEvent.click(save);
    await waitFor(() => expect(poll).toHaveAttribute("aria-busy", "true"));
    expect(poll).toBeEnabled();
    expect(poll).toHaveFocus();
    expect(pollTelegramGateway).toHaveBeenCalledTimes(1);
    expect(updateTelegramGateway).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    poll.focus();
    expect(poll).toBeEnabled();
    let focusWhenDisabled: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!poll.hasAttribute("disabled")) return;
      focusWhenDisabled ??= document.activeElement;
    });
    observer.observe(poll, { attributes: true, attributeFilter: ["disabled"] });
    await act(async () => {
      release({ status: "ok", processed: 2 });
    });
    expect(await screen.findByText("轮询完成，处理 2 条消息")).toBeInTheDocument();
    expect(focusWhenDisabled).toBe(save);
    expect(poll).toBeDisabled();
    expect(save).toHaveFocus();
    observer.disconnect();
  });

  it("does not steal focus when telegram polling ends after focus moved", async () => {
    let release: (row: { status: string; processed: number }) => void = () => {};
    vi.mocked(pollTelegramGateway).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Telegram 网关");
    const toggle = await screen.findByRole("checkbox", { name: "启用每分钟本地轮询" });
    fireEvent.click(toggle);
    const poll = screen.getByRole("button", { name: "立即轮询" });
    poll.focus();
    fireEvent.click(poll);
    fireEvent.click(toggle);
    toggle.focus();
    await act(async () => {
      release({ status: "ok", processed: 1 });
    });
    expect(await screen.findByText("轮询完成，处理 1 条消息")).toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("does not test the mailbox twice and keeps focus on 测试连接", async () => {
    let release: (row: {
      ok: boolean;
      imap_ok: boolean;
      smtp_ok: boolean;
      error?: string | null;
    }) => void = () => {};
    vi.mocked(testEmailConnection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const test = await screen.findByRole("button", { name: "测试连接" });
    test.focus();
    fireEvent.click(test);
    fireEvent.click(test);
    await waitFor(() => expect(test).toHaveAttribute("aria-busy", "true"));
    expect(test).toBeEnabled();
    expect(test).toHaveFocus();
    expect(test).toHaveTextContent("测试中…");
    expect(testEmailConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ ok: false, imap_ok: false, smtp_ok: false, error: "连不上" });
    });
    await waitFor(() => expect(test).not.toHaveAttribute("aria-busy"));
    expect(test).toBeEnabled();
    expect(test).toHaveFocus();
    expect(screen.getByText("IMAP 失败")).toBeInTheDocument();
  });

  function mcpServer(name: string, installed = false) {
    return {
      name,
      description: `${name} 说明`,
      category: "search",
      env_vars: {},
      installed,
    };
  }

  function mcpInstallButton(name: string) {
    const node = document.querySelector<HTMLButtonElement>(`button[data-mcp-install="${name}"]`);
    if (!node) throw new Error(`missing MCP install ${name}`);
    return node;
  }

  it("does not install an MCP server twice and keeps focus on 安装", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([mcpServer("brave"), mcpServer("tavily")]);
    let release: (row: { ok: boolean; message: string }) => void = () => {};
    vi.mocked(installMcpConnector).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    expect(await screen.findByText("brave")).toBeInTheDocument();
    const install = mcpInstallButton("brave");
    const other = mcpInstallButton("tavily");
    install.focus();
    fireEvent.click(install);
    fireEvent.click(install);
    fireEvent.click(other);
    await waitFor(() => expect(install).toHaveAttribute("aria-busy", "true"));
    expect(install).toBeEnabled();
    expect(install).toHaveFocus();
    expect(install).toHaveTextContent("安装中…");
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");
    expect(installMcpConnector).toHaveBeenCalledTimes(1);
    expect(installMcpConnector).toHaveBeenCalledWith("brave");
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      release({ ok: true, message: "installed" });
    });
    expect(await screen.findByTestId("mcp-install-notice")).toHaveTextContent(
      '"brave" 已安装。重启后端后生效。',
    );
    expect(install).toBeDisabled();
    expect(install).toHaveTextContent("已安装");
    await waitFor(() => expect(other).toHaveFocus());
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();

    vi.mocked(installMcpConnector).mockResolvedValueOnce({ ok: true, message: "installed" });
    fireEvent.click(other);
    await waitFor(() => expect(installMcpConnector).toHaveBeenCalledTimes(2));
    expect(installMcpConnector).toHaveBeenLastCalledWith("tavily");
  });

  it("moves MCP install focus to the previous 安装 when nothing follows", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([
      mcpServer("brave", true),
      mcpServer("tavily"),
      mcpServer("context7"),
    ]);
    vi.mocked(installMcpConnector).mockResolvedValue({ ok: true, message: "installed" });
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    const installed = await screen.findByRole("button", { name: "已安装" });
    expect(installed).toBeDisabled();
    const previous = mcpInstallButton("tavily");
    const install = mcpInstallButton("context7");
    install.focus();
    fireEvent.click(install);
    fireEvent.click(installed);
    expect(await screen.findByTestId("mcp-install-notice")).toHaveTextContent(
      '"context7" 已安装。重启后端后生效。',
    );
    expect(previous).toHaveFocus();
    expect(installMcpConnector).toHaveBeenCalledTimes(1);
  });

  it("focuses the MCP install notice when no other server can be installed", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([mcpServer("brave")]);
    vi.mocked(installMcpConnector).mockResolvedValue({ ok: true, message: "installed" });
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    const install = await screen.findByRole("button", { name: "安装" });
    install.focus();
    let focusWhenNoticeAppeared: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!screen.queryByTestId("mcp-install-notice")) return;
      focusWhenNoticeAppeared ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    fireEvent.click(install);
    const notice = await screen.findByTestId("mcp-install-notice");
    expect(notice).toHaveTextContent('"brave" 已安装。重启后端后生效。');
    expect(focusWhenNoticeAppeared).toBe(notice);
    expect(notice).toHaveFocus();
    expect(mcpInstallButton("brave")).toBeDisabled();
    observer.disconnect();
  });

  it("does not steal focus when MCP install finishes after focus moved", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([mcpServer("brave"), mcpServer("tavily")]);
    let release: (row: { ok: boolean; message: string }) => void = () => {};
    vi.mocked(installMcpConnector).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    expect(await screen.findByText("brave")).toBeInTheDocument();
    const install = mcpInstallButton("brave");
    const other = mcpInstallButton("tavily");
    install.focus();
    fireEvent.click(install);
    other.focus();
    await act(async () => {
      release({ ok: true, message: "installed" });
    });
    expect(await screen.findByTestId("mcp-install-notice")).toBeInTheDocument();
    expect(other).toHaveFocus();
    expect(install).toHaveTextContent("已安装");
  });

  it("keeps 安装 focused and uses the toast when MCP install fails", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([mcpServer("brave"), mcpServer("tavily")]);
    vi.mocked(installMcpConnector).mockResolvedValueOnce({ ok: false, message: "装不上" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderWithRouter(<SettingsPage />);
    await expandSection("MCP 市场");
    expect(await screen.findByText("brave")).toBeInTheDocument();
    const install = mcpInstallButton("brave");
    install.focus();
    fireEvent.click(install);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("装不上", "设置"));
    expect(install).toBeEnabled();
    expect(install).toHaveFocus();
    expect(install).toHaveTextContent("安装");
    expect(install).not.toHaveAttribute("aria-busy");
    expect(screen.queryByTestId("mcp-install-notice")).not.toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();

    vi.mocked(installMcpConnector).mockResolvedValueOnce({ ok: false, message: "   " });
    fireEvent.click(install);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("安装失败", "设置"));
    expect(install).toHaveFocus();

    vi.mocked(installMcpConnector).mockRejectedValueOnce(new ApiError("后端拒绝", 500));
    fireEvent.click(install);
    await waitFor(() => expect(addError).toHaveBeenCalledWith("后端拒绝", "设置"));
    expect(install).toBeEnabled();
    expect(install).toHaveFocus();
    expect(mcpInstallButton("tavily")).toHaveTextContent("安装");
  });
});
