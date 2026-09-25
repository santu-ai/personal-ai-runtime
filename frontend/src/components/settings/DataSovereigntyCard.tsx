import { useRef, useState } from "react";
import {
  downloadExport,
  exportEncryptedData,
  importData,
  importEncryptedData,
  destroyAllData,
  ApiError,
} from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useInvalidateSettings } from "../../hooks/useSettingsQuery";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Input } from "../ui/Input";

interface Props {
  /** Called after a successful import so the parent can refetch core settings. */
  onAfterImport?: () => void;
  /** Skip outer Card + title when wrapped by Disclosure. */
  embedded?: boolean;
}

export default function DataSovereigntyCard({ onAfterImport, embedded = false }: Props) {
  const addError = useErrorStore((s) => s.addError);
  const invalidateSettings = useInvalidateSettings();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importConfirm, setImportConfirm] = useState("");
  const [encryptPassword, setEncryptPassword] = useState("");
  const [encryptExporting, setEncryptExporting] = useState(false);
  const [encryptImporting, setEncryptImporting] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [encryptExportNotice, setEncryptExportNotice] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const destroyingRef = useRef(false);
  const exportLock = useRef(false);
  const encryptImportingRef = useRef(false);
  const passwordLive = useRef("");
  const encryptExportGen = useRef(0);

  const reload = () => {
    invalidateSettings();
    onAfterImport?.();
  };

  const editPassword = (value: string) => {
    if (passwordLive.current === value) return;
    passwordLive.current = value;
    encryptExportGen.current += 1;
    setEncryptPassword(value);
    setEncryptExportNotice(null);
  };

  const handleExport = async () => {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setExportNotice(null);
    try {
      await downloadExport();
      setExportNotice("已导出");
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "导出失败", "设置");
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  };

  const handleImport = async (data: Record<string, unknown>, write: boolean) => {
    setImporting(true);
    try {
      await importData(data, !write);
      if (write) setImportConfirm("");
      reload();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "导入失败", "设置");
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>, write: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      await handleImport(data, write);
    } catch {
      addError("无法解析备份文件", "设置");
    } finally {
      e.target.value = "";
    }
  };

  const handleEncryptedExport = async () => {
    if (exportLock.current) return;
    const password = passwordLive.current;
    if (!password) return;
    const gen = encryptExportGen.current;
    exportLock.current = true;
    setEncryptExporting(true);
    setEncryptExportNotice(null);
    try {
      const result = await exportEncryptedData(password);
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `personal-ai-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (encryptExportGen.current === gen) setEncryptExportNotice("已导出");
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "加密导出失败", "设置");
    } finally {
      exportLock.current = false;
      setEncryptExporting(false);
    }
  };

  const handleEncryptedImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (encryptImportingRef.current) {
      e.target.value = "";
      return;
    }
    const submitted = passwordLive.current;
    if (!file || !submitted) {
      addError("请选择文件并输入密码", "设置");
      return;
    }
    encryptImportingRef.current = true;
    setEncryptImporting(true);
    setStatusMessage(null);
    try {
      const raw = await file.text();
      const { data, password } = JSON.parse(raw) as { data: string; password?: string };
      await importEncryptedData(data, password || submitted);
      setStatusMessage("加密导入成功");
      if (passwordLive.current === submitted) editPassword("");
      reload();
    } catch {
      addError("加密导入失败，请检查密码和文件", "设置");
    } finally {
      encryptImportingRef.current = false;
      setEncryptImporting(false);
      e.target.value = "";
    }
  };

  const handleDestroy = async () => {
    if (destroyingRef.current) return;
    destroyingRef.current = true;
    setDestroying(true);
    try {
      await destroyAllData();
      setConfirmDestroy(false);
      setStatusMessage("数据已销毁，请重新启动应用");
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "销毁失败", "设置");
    } finally {
      destroyingRef.current = false;
      setDestroying(false);
    }
  };

  const body = (
    <>
      {!embedded && <h3 className="text-sm font-medium text-fg-secondary mb-3">数据主权</h3>}
      <p className="text-sm text-fg-tertiary mb-4">导出完整个人数据快照，或从备份文件导入。</p>
      {statusMessage && <p className="text-xs text-success mb-3">{statusMessage}</p>}
      <div className="flex flex-wrap gap-3 items-center">
        <Button
          data-sovereignty-action="export"
          onClick={() => void handleExport()}
          aria-busy={exporting || undefined}
          className={exporting ? "opacity-50" : ""}
        >
          {exporting ? "导出中…" : "导出全部数据"}
        </Button>
        {exportNotice ? (
          <p className="text-xs text-success" role="status" data-testid="export-notice">
            {exportNotice}
          </p>
        ) : null}
        <label className="inline-block">
          <span className="inline-flex px-4 py-2 text-sm rounded-lg font-medium bg-surface-overlay hover:bg-border-strong text-fg-primary cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
            {importing ? "导入中…" : "导入备份（只读）"}
          </span>
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => handleImportFile(e, false)}
            disabled={importing}
          />
        </label>
      </div>
      <div className="mt-4 flex gap-2 items-center">
        <Input
          value={importConfirm}
          onChange={(e) => setImportConfirm(e.target.value)}
          placeholder="写入导入请输入 DESTROY_AND_IMPORT"
          className="flex-1 text-xs"
        />
        <label className="shrink-0">
          <span
            className={`inline-flex px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer transition-colors ${
              importing || importConfirm !== "DESTROY_AND_IMPORT"
                ? "bg-surface-overlay text-fg-disabled cursor-not-allowed"
                : "bg-danger hover:bg-danger/90 text-white"
            }`}
          >
            覆盖导入
          </span>
          <input
            type="file"
            accept=".json"
            className="hidden"
            disabled={importing || importConfirm !== "DESTROY_AND_IMPORT"}
            onChange={(e) => handleImportFile(e, true)}
          />
        </label>
      </div>
      <hr className="mt-4 border-border-subtle" />
      <div className="mt-4">
        <h4 className="text-xs font-medium text-fg-secondary mb-2">加密备份（端到端加密）</h4>
        <div className="flex flex-wrap gap-3 items-end">
          <Input
            value={encryptPassword}
            onChange={(e) => editPassword(e.target.value)}
            placeholder="输入加密密码"
            className="flex-1 text-xs"
          />
          <Button
            data-sovereignty-action="encrypt-export"
            onClick={() => void handleEncryptedExport()}
            disabled={!encryptPassword && !encryptExporting}
            aria-busy={encryptExporting || undefined}
            className={encryptExporting ? "opacity-50" : ""}
          >
            {encryptExporting ? "加密导出中…" : "加密导出"}
          </Button>
          {encryptExportNotice ? (
            <p className="text-xs text-success" role="status" data-testid="encrypt-export-notice">
              {encryptExportNotice}
            </p>
          ) : null}
          <label className="inline-block">
            <span
              className={`inline-flex px-4 py-2 text-sm rounded-lg font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${encryptImporting || !encryptPassword ? "bg-surface-overlay text-fg-disabled" : "bg-surface-overlay hover:bg-border-strong text-fg-primary"}`}
            >
              {encryptImporting ? "导入中…" : "加密导入"}
            </span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              data-sovereignty-import="encrypted"
              disabled={encryptImporting || !encryptPassword}
              onChange={(e) => void handleEncryptedImport(e)}
            />
          </label>
        </div>
      </div>
      <hr className="mt-4 border-border-subtle" />
      <div className="mt-4">
        <h4 className="text-xs font-medium text-danger mb-2">危险操作</h4>
        <Button variant="danger" onClick={() => setConfirmDestroy(true)} disabled={destroying}>
          销毁全部数据
        </Button>
        <p className="text-xs text-fg-disabled mt-1">
          永久删除所有对话、记忆、目标和事件。不可恢复。
        </p>
      </div>
      <Dialog
        open={confirmDestroy}
        title="销毁全部数据"
        description="确定销毁全部个人数据？此操作不可撤销！"
        confirmLabel={destroying ? "销毁中…" : "销毁"}
        variant="danger"
        confirmBusy={destroying}
        onConfirm={() => void handleDestroy()}
        onCancel={() => {
          if (destroyingRef.current) return;
          setConfirmDestroy(false);
        }}
      />
    </>
  );

  return embedded ? body : <Card>{body}</Card>;
}
