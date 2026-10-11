import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EmailSettingsResponse } from "../../api/settings";
import EmailConfigCard from "./EmailConfigCard";

const email: EmailSettingsResponse = {
  config: {
    provider: "gmail",
    user: "me@gmail.com",
    password: "",
    imap_host: "imap.gmail.com",
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
  },
  provider: "gmail",
  help: "使用 Gmail 应用专用密码连接 IMAP/SMTP。",
};

describe("EmailConfigCard field names", () => {
  it("connects the address and app password names to their fields", () => {
    render(<EmailConfigCard email={email} onSaved={() => {}} embedded />);

    const address = screen.getByLabelText("Gmail 地址");
    expect(address).toHaveValue("me@gmail.com");
    expect(screen.getByText("Gmail 地址")).toHaveAttribute("for", address.id);

    const password = screen.getByLabelText("应用专用密码");
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByText("应用专用密码")).toHaveAttribute("for", password.id);
    expect(screen.getByRole("button", { name: "显示密码" })).not.toBe(password);
  });

  it("names the mailbox password when the desktop wrap cannot be opened", () => {
    render(
      <EmailConfigCard
        email={{
          ...email,
          config: {
            ...email.config,
            needs_reentry: true,
            reentry_reason:
              "邮箱密码需要重新填写。它是用桌面的 safeStorage 包过的，当前这个后端进程打不开。重新填写并保存之后就能用。",
          },
        }}
        onSaved={() => {}}
        embedded
      />,
    );
    expect(screen.getByTestId("secret-reentry")).toHaveTextContent("邮箱密码需要重新填写");
    expect(screen.getByTestId("secret-reentry")).toHaveTextContent("safeStorage");
  });
});
