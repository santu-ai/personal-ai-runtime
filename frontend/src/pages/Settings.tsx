import { useEffect, useState } from "react";
import { useErrorStore } from "../stores/errorStore";
import {
  useSettingsCoreQuery,
  useSettingsHealthQuery,
  useMcpStatusQuery,
} from "../hooks/useSettingsQuery";
import type { LlmSettingsResponse, EmailSettingsResponse } from "../api/client";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Spinner from "../components/ui/Spinner";
import Disclosure from "../components/ui/Disclosure";
import LlmConfigCard from "../components/settings/LlmConfigCard";
import EmailConfigCard from "../components/settings/EmailConfigCard";
import DataSovereigntyCard from "../components/settings/DataSovereigntyCard";
import CapabilityTrustPanel from "../components/settings/CapabilityTrustPanel";
import PromptEditor from "../components/settings/PromptEditor";
import McpMarketplace from "../components/settings/McpMarketplace";
import McpServerList from "../components/settings/McpServerList";

export default function SettingsPage() {
  const addError = useErrorStore((s) => s.addError);
  const {
    data: core,
    isLoading: coreLoading,
    error: coreError,
    refetch: refetchCore,
  } = useSettingsCoreQuery();
  const { data: health, error: healthError } = useSettingsHealthQuery();
  const { data: mcpStatus } = useMcpStatusQuery();

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

  if (coreLoading && !core) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-fg-tertiary">
        <Spinner />
        加载设置…
      </div>
    );
  }

  if (!core) {
    const loadError =
      coreError instanceof Error ? coreError.message : coreError ? String(coreError) : null;
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-fg-tertiary p-6">
        <p>{loadError || "无法加载已保存的配置"}</p>
        <Button onClick={() => void refetchCore()}>重试</Button>
      </div>
    );
  }

  const mcpSummary = health?.startup?.checks?.mcp;
  const mcpServers = mcpStatus?.enabled ? (mcpStatus.servers ?? []) : [];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-fg-primary">设置</h2>
            <p className="text-sm text-fg-tertiary mt-1">LLM、邮箱与数据管理</p>
          </div>
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
        </div>

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
          {!mcpSummary && !mcpStatus?.enabled ? (
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
                    {mcpStatus?.total_tools != null ? `（共 ${mcpStatus.total_tools} 个工具）` : ""}
                  </p>
                ))}
              <McpServerList servers={mcpServers} />
            </>
          )}
        </Disclosure>

        <Disclosure title="MCP 市场" description="浏览并安装社区 MCP 服务器">
          <p className="text-sm text-fg-tertiary mb-3">
            浏览并安装社区 MCP 服务器，扩展 AI 的能力。
          </p>
          <McpMarketplace />
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
