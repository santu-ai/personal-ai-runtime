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
    expect(await screen.findByText("（无法生成摘要）")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
  });

  it("holds the summary failure until the reread finishes", async () => {
    vi.mocked(getInboxEmailSummary).mockRejectedValueOnce(new Error("   "));
    render(<InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={vi.fn()} />);
    const alert = await screen.findByTestId("inbox-summary-load-error");
    expect(alert).toHaveTextContent("摘要生成失败");
    expect(screen.getByText("请尽快回复")).toBeInTheDocument();
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "重试" })).toHaveFocus());

    let release: (row: { summary: string }) => void = () => {};
    vi.mocked(getInboxEmailSummary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const retry = within(alert).getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toHaveFocus();
    expect(screen.getByTestId("inbox-summary-load-error")).toHaveTextContent("摘要生成失败");
    expect(screen.queryByText("AI 正在生成摘要...")).not.toBeInTheDocument();

    release({ summary: "需要今天回复" });
    expect(await screen.findByText("需要今天回复")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-summary-load-error")).not.toBeInTheDocument();
  });

  it("does not keep the previous mail's summary failure", async () => {
    vi.mocked(getInboxEmailSummary).mockRejectedValueOnce(new Error("上一封读不到"));
    const { rerender } = render(
      <InboxEmailDetailModal email={mail("e1", "请尽快回复")} onClose={vi.fn()} />,
    );
    expect(await screen.findByTestId("inbox-summary-load-error")).toHaveTextContent("上一封读不到");

    let release: (row: { summary: string }) => void = () => {};
    vi.mocked(getInboxEmailSummary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    rerender(<InboxEmailDetailModal email={mail("e2", "另一封账单")} onClose={vi.fn()} />);
    expect(await screen.findByText("AI 正在生成摘要...")).toBeInTheDocument();
    expect(screen.queryByText("上一封读不到")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-summary-load-error")).not.toBeInTheDocument();
    expect(screen.getByText("另一封账单")).toBeInTheDocument();

    release({ summary: "这封的摘要" });
    expect(await screen.findByText("这封的摘要")).toBeInTheDocument();
  });
});
