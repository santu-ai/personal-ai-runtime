import { useRef, useState } from "react";
import {
  updateLlmSettings,
  testLlmConnection,
  ApiError,
  type LlmSettingsResponse,
  type LlmProviderConfig,
} from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import { Input, PasswordInput } from "../ui/Input";

const MASKED_SECRET = "••••••••";

function emptyProvider(id = ""): LlmProviderConfig {
  return {
    id,
    name: "",
    type: "openai_compatible",
    base_url: "",
    model: "",
    api_key: "",
    enabled: true,
  };
}

interface Props {
  llm: LlmSettingsResponse;
  onSaved: (next: LlmSettingsResponse) => void;
  /** Skip outer Card + title when wrapped by Disclosure. */
  embedded?: boolean;
}

export default function LlmConfigCard({ llm, onSaved, embedded = false }: Props) {
  const addError = useErrorStore((s) => s.addError);

  const [llmForm, setLlmForm] = useState<LlmProviderConfig[]>(
    llm.config.providers.map((p) => ({ ...p })),
  );
  const [llmDefault, setLlmDefault] = useState(llm.config.default_provider);
  const [llmTemperature, setLlmTemperature] = useState(llm.config.temperature);
  const [llmMaxTokens, setLlmMaxTokens] = useState(llm.config.max_tokens);
  const [savingLlm, setSavingLlm] = useState(false);
  const [testingLlm, setTestingLlm] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Record<string, true>>({});
  const savingRef = useRef(false);
  const testingRef = useRef(false);
  const saveGen = useRef(0);
  const testGen = useRef<Record<string, number>>({});

  const markDirty = () => {
    saveGen.current += 1;
    setSaveNotice(null);
  };

  const clearConnected = (providerId: string) => {
    testGen.current[providerId] = (testGen.current[providerId] ?? 0) + 1;
    setConnectedIds((ids) => {
      if (!ids[providerId]) return ids;
      const next = { ...ids };
      delete next[providerId];
      return next;
    });
  };

  const updateProvider = (index: number, patch: Partial<LlmProviderConfig>) => {
    const currentId = llmForm[index]?.id;
    setLlmForm((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    if (currentId) clearConnected(currentId);
    markDirty();
  };

  const applyPreset = (index: number, presetId: string) => {
    const preset = llm.presets[presetId];
    if (!preset) return;
    updateProvider(index, {
      id: presetId,
      name: preset.name,
      type: preset.type as LlmProviderConfig["type"],
      base_url: preset.base_url,
      model: preset.model,
      api_key: preset.type === "ollama" ? "ollama" : "",
    });
  };

  const addProvider = () => {
    const id = `custom-${Date.now()}`;
    setLlmForm((prev) => [...prev, emptyProvider(id)]);
    markDirty();
  };

  const removeProvider = (index: number) => {
    const currentId = llmForm[index]?.id;
    setLlmForm((prev) => prev.filter((_, i) => i !== index));
    if (currentId) clearConnected(currentId);
    markDirty();
  };

  const handleSaveLlm = async () => {
    if (savingRef.current) return;
    const gen = saveGen.current;
    savingRef.current = true;
    setSavingLlm(true);
    setSaveNotice(null);
    try {
      const result = await updateLlmSettings({
        default_provider: llmDefault,
        temperature: llmTemperature,
        max_tokens: llmMaxTokens,
        providers: llmForm,
      });
      onSaved({
        ...llm,
        ...result,
        presets: result.presets ?? llm.presets,
        provider_types: result.provider_types ?? llm.provider_types,
      });
      if (saveGen.current === gen) setSaveNotice("已保存");
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "保存 LLM 配置失败", "设置");
    } finally {
      savingRef.current = false;
      setSavingLlm(false);
    }
  };

  const handleTestLlm = async (providerId: string) => {
    if (testingRef.current) return;
    const gen = testGen.current[providerId] ?? 0;
    testingRef.current = true;
    setTestingLlm(providerId);
    setConnectedIds((ids) => {
      if (!ids[providerId]) return ids;
      const next = { ...ids };
      delete next[providerId];
      return next;
    });
    try {
      const result = await testLlmConnection(providerId);
      if (!result.ok) {
        addError(result.error || "连接测试失败", "LLM");
        return;
      }
      if ((testGen.current[providerId] ?? 0) === gen) {
        setConnectedIds((ids) => ({ ...ids, [providerId]: true }));
      }
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "连接测试失败", "LLM");
    } finally {
      testingRef.current = false;
      setTestingLlm(null);
    }
  };

  const body = (
    <>
      {!embedded && <h3 className="text-sm font-medium text-fg-secondary mb-3">LLM 配置</h3>}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-fg-tertiary block mb-1">默认 Provider</label>
          <select
            value={llmDefault}
            onChange={(e) => {
              setLlmDefault(e.target.value);
              markDirty();
            }}
            className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {llmForm.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-fg-tertiary block mb-1">Temperature</label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={llmTemperature}
            onChange={(e) => {
              setLlmTemperature(parseFloat(e.target.value) || 0);
              markDirty();
            }}
          />
        </div>
        <div>
          <label className="text-xs text-fg-tertiary block mb-1">Max Tokens</label>
          <Input
            type="number"
            min="256"
            value={llmMaxTokens}
            onChange={(e) => {
              setLlmMaxTokens(parseInt(e.target.value, 10) || 4096);
              markDirty();
            }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {llmForm.map((provider, index) => {
          const status = llm.providers_status.find((s) => s.name === provider.id);
          return (
            <div
              key={`${provider.id}-${index}`}
              className="border border-border-subtle rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-fg-primary">{provider.name || provider.id}</span>
                  {status && (
                    <Badge tone={status.available ? "success" : "danger"}>
                      {status.available ? "可用" : "不可用"}
                    </Badge>
                  )}
                  {provider.id === llmDefault && <Badge tone="default">默认</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-llm-action="test"
                    data-llm-provider={provider.id}
                    onClick={() => void handleTestLlm(provider.id)}
                    aria-busy={testingLlm === provider.id || undefined}
                    className={testingLlm === provider.id ? "opacity-50" : ""}
                  >
                    {testingLlm === provider.id ? "测试中…" : "测试"}
                  </Button>
                  {llmForm.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeProvider(index)}>
                      删除
                    </Button>
                  )}
                </div>
              </div>
              {connectedIds[provider.id] ? (
                <p className="text-xs text-success" data-testid={`llm-test-ok-${provider.id}`}>
                  连接正常
                </p>
              ) : null}

              <div className="flex gap-2 flex-wrap">
                {Object.keys(llm.presets ?? {}).map((presetId) => (
                  <button
                    key={presetId}
                    type="button"
                    onClick={() => applyPreset(index, presetId)}
                    className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-border-strong text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {llm.presets?.[presetId]?.name ?? presetId}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-fg-tertiary block mb-1">ID</label>
                  <Input
                    value={provider.id}
                    onChange={(e) => updateProvider(index, { id: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-fg-tertiary block mb-1">显示名称</label>
                  <Input
                    value={provider.name}
                    onChange={(e) => updateProvider(index, { name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-fg-tertiary block mb-1">类型</label>
                  <select
                    value={provider.type}
                    onChange={(e) =>
                      updateProvider(index, {
                        type: e.target.value as LlmProviderConfig["type"],
                        api_key: e.target.value === "ollama" ? "ollama" : provider.api_key,
                      })
                    }
                    className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <option value="openai_compatible">OpenAI 兼容</option>
                    <option value="ollama">Ollama 本地</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-fg-tertiary block mb-1">模型</label>
                  <Input
                    value={provider.model}
                    onChange={(e) => updateProvider(index, { model: e.target.value })}
                    placeholder="deepseek-chat / gpt-4o / qwen2.5:7b"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-fg-tertiary block mb-1">Base URL</label>
                  <Input
                    value={provider.base_url}
                    onChange={(e) => updateProvider(index, { base_url: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-fg-tertiary block mb-1">API Key</label>
                  <PasswordInput
                    value={provider.api_key}
                    isSavedSecret={Boolean(
                      provider.has_api_key && provider.api_key === MASKED_SECRET,
                    )}
                    onChange={(e) => updateProvider(index, { api_key: e.target.value })}
                    placeholder={
                      provider.type === "ollama" ? "ollama（可留空）" : "留空则使用 .env 中的密钥"
                    }
                  />
                  {provider.has_api_key && provider.api_key === MASKED_SECRET && (
                    <p className="text-xs text-fg-disabled mt-1">已保存密钥，留空则不修改</p>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(e) => updateProvider(index, { enabled: e.target.checked })}
                  className="rounded"
                />
                启用此 Provider
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={addProvider}>
          添加 Provider
        </Button>
        <Button
          data-llm-action="save"
          onClick={() => void handleSaveLlm()}
          aria-busy={savingLlm || undefined}
          className={savingLlm ? "opacity-50" : ""}
        >
          {savingLlm ? "保存中…" : "保存 LLM 配置"}
        </Button>
        {saveNotice ? (
          <p className="text-xs text-success" role="status" data-testid="llm-save-notice">
            {saveNotice}
          </p>
        ) : null}
      </div>
    </>
  );

  return embedded ? body : <Card>{body}</Card>;
}
