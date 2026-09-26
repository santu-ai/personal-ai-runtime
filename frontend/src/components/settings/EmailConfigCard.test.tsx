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
});
