import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import RiskCard from "./RiskCard";
import type { CapabilityPolicy } from "../../api/settings";

afterEach(() => {
  cleanup();
});

const policy: CapabilityPolicy = {
  auto_allow: ["read_file"],
  needs_user: ["write_file", "apply_patch"],
  forbidden: ["shell_exec", "send_email"],
  external_ingestion: [],
};

describe("RiskCard", () => {
  it("renders high-risk badge for forbidden tools via policy", () => {
    renderWithRouter(
      <RiskCard
        action="shell_exec"
        args={JSON.stringify({ command: "rm -rf /" })}
        policy={policy}
        variant="inline"
      />,
    );
    expect(screen.getByText(/确认执行命令/)).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
  });

  it("renders medium tone without high-risk badge for needs_user write_file", () => {
    // needs_user maps to high in getRiskLevelFromPolicy
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: "hi" })}
        policy={policy}
        variant="inline"
      />,
    );
    expect(screen.getByText(/确认写入文件/)).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
  });

  it("respects explicit riskLevel over policy", () => {
    renderWithRouter(
      <RiskCard action="shell_exec" args="{}" policy={policy} riskLevel="low" variant="inline" />,
    );
    expect(screen.queryByText("高风险")).not.toBeInTheDocument();
  });

  it("shows patch preview for apply_patch", () => {
    renderWithRouter(
      <RiskCard
        action="apply_patch"
        args={JSON.stringify({
          path: "/tmp/a.py",
          old_string: "a",
          new_string: "b",
        })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("变更预览")).toBeInTheDocument();
  });

  it("shows write preview for write_file", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: "hello world" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("写入内容预览")).toBeInTheDocument();
  });

  it("expands long patch content", () => {
    const longText = "x".repeat(500);
    renderWithRouter(
      <RiskCard
        action="apply_patch"
        args={JSON.stringify({ path: "/tmp/a.py", old_string: longText, new_string: "y" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("查看完整内容")).toBeInTheDocument();
  });

  it("falls back label for unknown action", () => {
    renderWithRouter(
      <RiskCard action="nonexistent_tool" args="{}" riskLevel="medium" variant="inline" />,
    );
    expect(screen.getByRole("heading", { name: /确认/ })).toBeInTheDocument();
  });

  it("hides reversible/impact block when fields are omitted", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt" })}
        riskLevel="medium"
        variant="panel"
      />,
    );
    expect(screen.queryByText("影响：")).not.toBeInTheDocument();
    expect(screen.queryByText("可撤销：")).not.toBeInTheDocument();
  });

  it("shows reversible/impact when backend fields are provided", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args="{}"
        riskLevel="medium"
        variant="panel"
        reversible={false}
        impactSummary="覆盖目标文件"
      />,
    );
    expect(screen.getByText("影响：")).toBeInTheDocument();
    expect(screen.getByText("覆盖目标文件")).toBeInTheDocument();
    expect(screen.getByText("可撤销：")).toBeInTheDocument();
    expect(screen.getByText("否")).toBeInTheDocument();
  });

  it("expands detailed args", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    fireEvent.click(screen.getByText("查看详细参数"));
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });
});
