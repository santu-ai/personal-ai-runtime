import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithRouter } from "../test-utils";
import SettingsPage from "./Settings";

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

vi.mock("../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
}));

async function expandSection(title: string) {
  const trigger = await screen.findByRole("button", { name: new RegExp(title) });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
