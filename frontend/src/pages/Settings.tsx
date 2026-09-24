import { useEffect, useState } from "react";
import { useErrorStore } from "../stores/errorStore";
import {
  useSettingsCoreQuery,
  useSettingsHealthQuery,
  useMcpStatusQuery,
} from "../hooks/useSettingsQuery";
import type { LlmSettingsResponse, EmailSettingsResponse } from "../api/client";
import Badge from "../components/ui/Badge";
import Spinner from "../components/ui/Spinner";
import Disclosure from "../components/ui/Disclosure";
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import PageHeader from "../components/ui/PageHeader";
import LlmConfigCard from "../components/settings/LlmConfigCard";
import EmailConfigCard from "../components/settings/EmailConfigCard";
import DataSovereigntyCard from "../components/settings/DataSovereigntyCard";
import CapabilityTrustPanel from "../components/settings/CapabilityTrustPanel";
import PromptEditor from "../components/settings/PromptEditor";
import McpMarketplace from "../components/settings/McpMarketplace";
import McpServerList from "../components/settings/McpServerList";
import TelegramGatewayCard from "../components/settings/TelegramGatewayCard";

export default function SettingsPage() {
  const addError = useErrorStore((s) => s.addError);
  const {
    data: core,
    isFetching: coreFetching,
    error: coreError,
    refetch: refetchCore,
  } = useSettingsCoreQuery();
  const shownCoreError = useHeldQueryError(
    Boolean(core),
    coreError,
    coreFetching,
    "无法加载已保存的配置",
    "settings-core",
  );
  const { data: health, error: healthError } = useSettingsHealthQuery();
  const {
    data: mcpStatus,
    error: mcpError,
    isLoading: mcpLoading,
    isFetching: mcpFetching,
    refetch: refetchMcp,
  } = useMcpStatusQuery();
  const shownMcpError = useHeldQueryError(
    Boolean(mcpStatus),
    mcpError,
    mcpFetching,
    "加载 MCP 服务器失败",
    "mcp-status",
  );

  // Locally-cached copies of the loaded config so child cards can be re-rendered
  // with fresh data after a save without re-fetching the whole core bundle.
  const [llm, setLlm] = useState<LlmSettingsResponse | null>(null);
  const [email, setEmail] = useState<EmailSettingsResponse | null>(null);

  useEffect(() => {
    if (core) {
      setLlm(core.llm);
      setEmail(core.email);
    }
  }, [core]);

  useEffect(() => {
    if (healthError) {
      const msg = healthError instanceof Error ? healthError.message : "加载系统状态失败";
      addError(msg, "设置");
    }
  }, [healthError, addError]);

  useEffect(() => {
    if (mcpError) {
      addError(queryErrorMessage(mcpError, "加载 MCP 服务器失败"), "设置");
    }
  }, [mcpError, addError]);

  if (shownCoreError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <LoadErrorNotice
          message={shownCoreError}
          busy={coreFetching}
          onRetry={() => void refetchCore()}
          testId="settings-core-load-error"
        />
      </div>
    );
  }

  if (!core) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-fg-tertiary">
        <Spinner />
        加载设置…
      </div>
    );
  }

  const mcpSummary = health?.startup?.checks?.mcp;

  return (
    <div className="page-shell">
      <div className="page-container-narrow space-y-4">
        <PageHeader
          title="设置"
          description="LLM、邮箱与数据管理"
          actions={
            <Badge
              tone={
                health?.status === "ok"
                  ? "success"
                  : health?.status === "degraded"
                    ? "warning"
                    : "danger"
              }
            >
              {health?.status === "ok"
                ? "运行正常"
                : health?.status === "degraded"
                  ? "降级"
                  : health?.status || "未知"}
            </Badge>
          }
        />

        {llm && (
          <Disclosure title="LLM 配置" defaultOpen>
            <LlmConfigCard llm={llm} onSaved={setLlm} embedded />
          </Disclosure>
        )}

        {email && (
          <Disclosure title="Gmail 邮箱配置" description="IMAP/SMTP 连接">
            <EmailConfigCard email={email} onSaved={setEmail} embedded />
          </Disclosure>
        )}

        <Disclosure title="MCP 服务器" defaultOpen description="连接状态与工具数">
          {shownMcpError ? (
            <LoadErrorNotice
              message={shownMcpError}
              busy={mcpFetching}
              onRetry={() => void refetchMcp()}
              testId="mcp-status-load-error"
            />
          ) : mcpLoading ? (
            <p className="text-sm text-fg-tertiary">加载中…</p>
          ) : !mcpStatus?.enabled ? (
            <p className="text-sm text-fg-tertiary">MCP 未启用或连接信息不可用</p>
          ) : (
            <>
              {mcpSummary &&
                (mcpSummary.failed > 0 ? (
                  <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning">
                    MCP 服务 {mcpSummary.connected}/{mcpSummary.total} 已连接，
                    {mcpSummary.failed} 个连接失败。
                  </div>
                ) : (mcpSummary.available ?? 0) < mcpSummary.total ? (
                  <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning">
                    MCP 服务 {mcpSummary.connected}/{mcpSummary.total} 已连接，
                    {mcpSummary.total - (mcpSummary.available ?? 0)} 个凭证未配置（不可用）。
                  </div>
                ) : (
                  <p className="text-sm text-fg-secondary">
                    全部 {mcpSummary.total} 个 MCP 服务已连接
                    {mcpStatus.total_tools != null ? `（共 ${mcpStatus.total_tools} 个工具）` : ""}
                  </p>
                ))}
              <McpServerList servers={mcpStatus.servers ?? []} />
            </>
          )}
        </Disclosure>

        <Disclosure title="MCP 市场" description="浏览并安装社区 MCP 服务器">
          <p className="text-sm text-fg-tertiary mb-3">
            浏览并安装社区 MCP 服务器，扩展 AI 的能力。
          </p>
          <McpMarketplace />
        </Disclosure>

        <Disclosure title="Telegram 网关" description="本地轮询、审批与自动回复">
          <TelegramGatewayCard />
        </Disclosure>

        <Disclosure title="AI 能力与信任" description="工具风险分级与信任策略">
          <p className="text-xs text-fg-tertiary mb-4">
            工具风险分级来自
            capability_policy.json（与运行时闸门同一来源）。需要确认的操作可在同一对话内选择信任后自动放行。
          </p>
          <CapabilityTrustPanel />
        </Disclosure>

        <Disclosure title="系统人设" description="自定义 AI 身份与代码规则">
          <p className="text-sm text-fg-tertiary mb-3">
            自定义 AI 的身份定义和代码规则。修改后立即生效。
          </p>
          <PromptEditor />
        </Disclosure>

        <Disclosure title="数据主权" description="导出 / 导入 / 销毁个人数据">
          <DataSovereigntyCard embedded onAfterImport={() => void refetchCore()} />
        </Disclosure>
      </div>
    </div>
  );
}
