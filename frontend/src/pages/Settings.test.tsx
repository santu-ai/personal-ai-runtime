import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import SettingsPage from "./Settings";
import {
  ApiError,
  getCapabilityPolicy,
  getLlmSettings,
  getMcpStatus,
  getPromptConfig,
  testLlmConnection,
  updateEmailSettings,
  updateLlmSettings,
} from "../api/client";
import { listMcpRegistry } from "../api/connectors";
import { getTelegramGatewayStatus, type TelegramGatewayStatus } from "../api/settings";

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

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
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
    fireEvent.click(save);
    expect(await screen.findByTestId("llm-save-notice")).toHaveTextContent("已保存");

    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), {
      target: { value: "deepseek-reasoner" },
    });
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-reasoner")).toBeInTheDocument();
  });

  it("keeps the LLM form and skips the saved notice when saving fails", async () => {
    vi.mocked(updateLlmSettings).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("deepseek-chat")).toBeInTheDocument();
  });

  it("does not send a second LLM save while the first is in flight", async () => {
    let release: ((row: Awaited<ReturnType<typeof updateLlmSettings>>) => void) | undefined;
    vi.mocked(updateLlmSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<SettingsPage />);
    const save = await screen.findByRole("button", { name: "保存 LLM 配置" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(updateLlmSettings).toHaveBeenCalledTimes(1);
    expect(save).toHaveTextContent("保存中…");
    expect(save).toBeDisabled();

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
    expect(await screen.findByTestId("llm-save-notice")).toHaveTextContent("已保存");
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
    fireEvent.click(save);
    fireEvent.change(screen.getByDisplayValue("0.7"), { target: { value: "0.2" } });
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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存 LLM 配置" })).toBeEnabled(),
    );
    expect(screen.queryByTestId("llm-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("0.2")).toBeInTheDocument();
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
    fireEvent.click(test);
    await waitFor(() => expect(test).toBeEnabled());
    expect(screen.queryByText("连接正常")).not.toBeInTheDocument();
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
    fireEvent.click(test);
    fireEvent.click(test);
    expect(testLlmConnection).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), {
      target: { value: "other-model" },
    });
    release?.({ ok: true, provider: "deepseek" });
    await waitFor(() => expect(screen.getByRole("button", { name: "测试" })).toBeEnabled());
    expect(screen.queryByText("连接正常")).not.toBeInTheDocument();
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
    fireEvent.click(save);
    expect(await screen.findByTestId("email-save-notice")).toHaveTextContent("已保存");

    fireEvent.change(screen.getByDisplayValue("test@gmail.com"), {
      target: { value: "other@gmail.com" },
    });
    expect(screen.queryByTestId("email-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("other@gmail.com")).toBeInTheDocument();
  });

  it("keeps the email form and skips the saved notice when saving fails", async () => {
    vi.mocked(updateEmailSettings).mockRejectedValueOnce(new ApiError("写不进去", 500));
    renderWithRouter(<SettingsPage />);
    await expandSection("Gmail 邮箱配置");
    const save = await screen.findByRole("button", { name: "保存邮箱配置" });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.queryByTestId("email-save-notice")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("test@gmail.com")).toBeInTheDocument();
  });
});
