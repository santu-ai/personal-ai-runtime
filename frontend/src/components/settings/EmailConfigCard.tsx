import { useId, useRef, useState, type ReactNode } from "react";
import {
  updateEmailSettings,
  testEmailConnection,
  ApiError,
  type EmailSettingsResponse,
} from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import { Input, PasswordInput } from "../ui/Input";

const MASKED_SECRET = "••••••••";

/** 旁边已经写着的名字连到这一栏。点名字会进去，读屏也读出这个名字。 */
function NamedField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-fg-tertiary block mb-1">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

interface Props {
  email: EmailSettingsResponse;
  onSaved: (next: EmailSettingsResponse) => void;
  /** Skip outer Card + title when wrapped by Disclosure. */
  embedded?: boolean;
}

export default function EmailConfigCard({ email, onSaved, embedded = false }: Props) {
  const addError = useErrorStore((s) => s.addError);

  const [emailUser, setEmailUser] = useState(email.config.user);
  const [emailPass, setEmailPass] = useState(email.config.password);
  const [savingEmail, setSavingEmail] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{
    ok: boolean;
    imap_ok: boolean;
    smtp_ok: boolean;
    error?: string | null;
  } | null>(null);
  const savingRef = useRef(false);
  const testingRef = useRef(false);
  const saveGen = useRef(0);

  const markDirty = () => {
    saveGen.current += 1;
    setSaveNotice(null);
  };

  const handleSaveEmail = async () => {
    if (savingRef.current) return;
    const gen = saveGen.current;
    savingRef.current = true;
    setSavingEmail(true);
    setSaveNotice(null);
    try {
      const result = await updateEmailSettings({
        user: emailUser,
        password: emailPass,
        imap_host: email.config.imap_host || "imap.gmail.com",
        smtp_host: email.config.smtp_host || "smtp.gmail.com",
        smtp_port: email.config.smtp_port || 465,
      });
      onSaved({
        provider: email.provider,
        help: email.help,
        config: result.config,
      });
      if (saveGen.current === gen) setSaveNotice("已保存");
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "保存邮箱配置失败", "设置");
    } finally {
      savingRef.current = false;
      setSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTestingEmail(true);
    try {
      const result = await testEmailConnection({
        user: emailUser,
        password: emailPass,
        imap_host: email.config.imap_host || "imap.gmail.com",
        smtp_host: email.config.smtp_host || "smtp.gmail.com",
        smtp_port: email.config.smtp_port || 465,
      });
      setEmailTestResult(result);
      if (!result.ok) {
        addError(result.error || "邮箱连接测试失败", "邮箱");
      }
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "邮箱连接测试失败", "邮箱");
    } finally {
      testingRef.current = false;
      setTestingEmail(false);
    }
  };

  const body = (
    <>
      {!embedded && <h3 className="text-sm font-medium text-fg-secondary mb-3">Gmail 邮箱配置</h3>}
      <p className="text-xs text-fg-tertiary mb-4">
        {email.help || "使用 Gmail 应用专用密码连接 IMAP/SMTP。"}
      </p>

      <div className="space-y-3">
        <NamedField label="Gmail 地址">
          {(id) => (
            <Input
              id={id}
              type="email"
              value={emailUser}
              onChange={(e) => {
                setEmailUser(e.target.value);
                markDirty();
              }}
              placeholder="your-email@gmail.com"
            />
          )}
        </NamedField>
        <NamedField label="应用专用密码">
          {(id) => (
            <>
              <PasswordInput
                id={id}
                value={emailPass}
                isSavedSecret={emailPass === MASKED_SECRET}
                onChange={(e) => {
                  setEmailPass(e.target.value);
                  markDirty();
                }}
                placeholder="16 位应用专用密码"
              />
              {emailPass === MASKED_SECRET && (
                <p className="text-xs text-fg-disabled mt-1">已保存密码，留空则不修改</p>
              )}
            </>
          )}
        </NamedField>
      </div>

      {emailTestResult && (
        <div className="mt-3 flex gap-2 text-xs">
          <Badge tone={emailTestResult.imap_ok ? "success" : "danger"}>
            IMAP {emailTestResult.imap_ok ? "正常" : "失败"}
          </Badge>
          <Badge tone={emailTestResult.smtp_ok ? "success" : "danger"}>
            SMTP {emailTestResult.smtp_ok ? "正常" : "失败"}
          </Badge>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          data-email-action="save"
          onClick={() => void handleSaveEmail()}
          aria-busy={savingEmail || undefined}
          className={savingEmail ? "opacity-50" : ""}
        >
          {savingEmail ? "保存中…" : "保存邮箱配置"}
        </Button>
        <Button
          variant="ghost"
          data-email-action="test"
          onClick={() => void handleTestEmail()}
          aria-busy={testingEmail || undefined}
          className={testingEmail ? "opacity-50" : ""}
        >
          {testingEmail ? "测试中…" : "测试连接"}
        </Button>
        {saveNotice ? (
          <p className="text-xs text-success" role="status" data-testid="email-save-notice">
            {saveNotice}
          </p>
        ) : null}
      </div>
    </>
  );

  return embedded ? body : <Card>{body}</Card>;
}
