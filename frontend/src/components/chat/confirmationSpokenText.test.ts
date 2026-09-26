import { describe, expect, it } from "vitest";
import type { CapabilityPolicy } from "../../api/settings";
import { confirmationSpokenText } from "./ConfirmationDialog";

const policy: CapabilityPolicy = {
  auto_allow: ["read_file"],
  needs_user: ["write_file", "apply_patch", "send_email"],
  forbidden: ["shell_exec"],
  external_ingestion: [],
};

function spoken(
  name: string,
  args: Record<string, unknown>,
  rules: CapabilityPolicy | null = policy,
) {
  return confirmationSpokenText({ function_name: name, arguments: JSON.stringify(args) }, rules);
}

describe("confirmationSpokenText", () => {
  it("reads the suggestion title and the high-risk badge, not the label twice", () => {
    expect(spoken("write_file", { path: "/tmp/x", content: "data" })).toBe(
      "建议：写入文件。高风险。",
    );
  });

  it("adds the action sentence when the title does not already say it", () => {
    expect(spoken("apply_patch", { path: "/tmp/a.md" })).toBe(
      "建议：修改文件。高风险。/tmp/a.md。",
    );
    expect(spoken("shell_exec", { command: "ls" })).toBe("确认执行命令。高风险。$ ls。");
  });

  it("reads a low-risk confirm title and the path", () => {
    expect(spoken("read_file", { path: "/tmp/a.md" })).toBe("确认读取文件。/tmp/a.md。");
  });

  it("reads the question and the extra note for ask_user, without high risk", () => {
    expect(
      spoken("ask_user", {
        question: "简报要覆盖最近几天？",
        context: "没有天数就无法筛选邮件",
      }),
    ).toBe("需要你补充一点信息。简报要覆盖最近几天？没有天数就无法筛选邮件。");
  });

  it("uses the visible fallback when ask_user has no question", () => {
    expect(spoken("ask_user", {})).toBe("需要你补充一点信息。助手需要你的回答才能继续。");
  });

  it("still names a suggestion before the policy arrives", () => {
    expect(spoken("set_timer", { message: "交报告" }, null)).toBe("建议：创建定时提醒。交报告。");
  });
});
