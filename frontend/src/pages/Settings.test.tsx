import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import SettingsPage from "./Settings";
import { ApiError, getMcpStatus, getPromptConfig } from "../api/client";
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
});
