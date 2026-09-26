import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InboxEmail } from "../../api/client";
import { getInboxEmailSummary } from "../../api/inbox";
import InboxEmailDetailModal from "./InboxEmailDetailModal";

vi.mock("../../api/inbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/inbox")>();
  return {
    ...actual,
    getInboxEmailSummary: vi.fn(),
  };
});

type SummaryRow = Awaited<ReturnType<typeof getInboxEmailSummary>>;

function summaryRow(email: InboxEmail, summary: string): SummaryRow {
  return {
    email_id: email.id,
    subject: email.subject,
    sender: email.sender,
    summary,
  };
}

function mail(id: string, subject: string): InboxEmail {
  return {
    id,
    sender: "boss@corp.com",
    subject,
    preview: "预览",
    received_at: "2026-08-17T01:00:00Z",
    category: "important",
    importance: 0.8,
    reason: "需要回复",
    notified: 0,
    digested: 0,
    status: "pending",
    created_at: "2026-08-17T01:00:00Z",
  };
}

describe("InboxEmailDetailModal", () => {
  beforeEach(() => {
    vi.mocked(getInboxEmailSummary).mockReset();
  });

  it("shows an empty summary without a retry", async () => {
    vi.mocked(getInboxEmailSummary).mockResolvedValue({
      email_id: "e1",
      subject: "请尽快回复",
      sender: "boss@corp.com",
      summary: "",
    });
    render(<InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("（无法生成摘要）");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
  });

  it("reads the summary while it is generating and when it arrives without moving focus", async () => {
    const openMail = mail("e1", "请尽快回复");
    let release: (row: SummaryRow) => void = () => {};
    vi.mocked(getInboxEmailSummary).mockImplementationOnce(
      () =>
        new Promise<SummaryRow>((resolve) => {
          release = resolve;
        }),
    );
    render(<InboxEmailDetailModal email={openMail} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "请尽快回复" });
    await waitFor(() => expect(dialog).toHaveFocus());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("AI 正在生成摘要...");
    expect(dialog).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    release(summaryRow(openMail, "需要今天回复"));
    expect(await screen.findByRole("status")).toHaveTextContent("需要今天回复");
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
    expect(dialog).toHaveFocus();
    expect(screen.getByRole("status")).not.toHaveFocus();
  });

  it("holds the summary failure until the reread finishes", async () => {
    vi.mocked(getInboxEmailSummary).mockRejectedValueOnce(new Error("   "));
    render(<InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={vi.fn()} />);
    const alert = await screen.findByTestId("inbox-summary-load-error");
    expect(alert).toHaveTextContent("摘要生成失败");
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());

    const openMail = mail("e1", "请尽快回复");
    let release: (row: SummaryRow) => void = () => {};
    vi.mocked(getInboxEmailSummary).mockImplementationOnce(
      () =>
        new Promise<SummaryRow>((resolve) => {
          release = resolve;
        }),
    );
    const retry = within(alert).getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("inbox-summary-load-error")).toHaveTextContent("摘要生成失败");
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    release(summaryRow(openMail, "需要今天回复"));
    expect(await screen.findByRole("status")).toHaveTextContent("需要今天回复");
    expect(screen.queryByTestId("inbox-summary-load-error")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveFocus();
  });

  it("does not keep the previous mail's summary failure", async () => {
    vi.mocked(getInboxEmailSummary).mockRejectedValueOnce(new Error("上一封读不到"));
    const { rerender } = render(
      <InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={vi.fn()} />,
    );
    expect(await screen.findByTestId("inbox-summary-load-error")).toHaveTextContent("上一封读不到");

    const nextMail = mail("e2", "另一封账单");
    let release: (row: SummaryRow) => void = () => {};
    vi.mocked(getInboxEmailSummary).mockImplementationOnce(
      () =>
        new Promise<SummaryRow>((resolve) => {
          release = resolve;
        }),
    );
    rerender(<InboxEmailDetailModal email={nextMail} onClose={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("AI 正在生成摘要...");
    expect(screen.queryByText("上一封读不到")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-summary-load-error")).not.toBeInTheDocument();
    expect(screen.getByText("另一封账单")).toBeInTheDocument();

    release(summaryRow(nextMail, "这封的摘要"));
    expect(await screen.findByRole("status")).toHaveTextContent("这封的摘要");
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
  });

  it("moves focus into the mail and returns it after Escape", async () => {
    vi.mocked(getInboxEmailSummary).mockResolvedValue({
      email_id: "e1",
      subject: "请尽快回复",
      sender: "boss@corp.com",
      summary: "需要今天回复",
    });
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "查看";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = render(
      <InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={onClose} />,
    );
    const dialog = screen.getByRole("dialog", { name: "请尽快回复" });
    await waitFor(() => expect(dialog).toHaveFocus());
    const close = screen
      .getAllByRole("button", { name: "关闭" })
      .find((button) => button.querySelector("[data-icon-name]"));
    expect(close?.querySelector("[data-icon-name]")).toHaveTextContent("关闭");
    expect(close?.querySelector("[data-icon-name]")).toHaveClass(
      "hidden",
      "group-focus-visible:block",
    );
    expect(close?.querySelector("[aria-hidden]")).toHaveClass("group-focus-visible:hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(<InboxEmailDetailModal email={null} onClose={onClose} />);
    expect(opener).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    opener.remove();
  });
});
