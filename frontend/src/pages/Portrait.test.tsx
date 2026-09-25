import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithRouter } from "../test-utils";
import { queryKeys } from "../hooks/useWsInvalidationBridge";
import { PortraitPanel } from "./Portrait";

vi.mock("../api/portrait", () => ({
  getPortrait: vi.fn(),
}));

import { getPortrait } from "../api/portrait";
import type { PortraitData } from "../api/portrait";

const mockGetPortrait = vi.mocked(getPortrait);

function renderPortrait() {
  return renderWithRouter(<PortraitPanel />);
}

function mockPortraitData(data: PortraitData) {
  mockGetPortrait.mockResolvedValue(data);
}

describe("PortraitPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockGetPortrait.mockReturnValue(new Promise(() => {})); // never resolves
    renderPortrait();
    expect(screen.getByText("正在生成你的 AI 画像…")).toBeInTheDocument();
  });

  it("shows error state with retry button", async () => {
    mockGetPortrait.mockRejectedValue(new Error("获取画像失败"));
    renderPortrait();
    await waitFor(
      () => {
        expect(screen.getByText("获取画像失败")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    const before = mockGetPortrait.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mockGetPortrait.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByText("画像尚未建立")).not.toBeInTheDocument();
  });

  it("uses the portrait fallback when the error has no message", async () => {
    mockGetPortrait.mockRejectedValue(new Error("   "));
    renderPortrait();
    expect(await screen.findByTestId("portrait-load-error")).toHaveTextContent("加载画像失败");
    expect(screen.queryByText("正在生成你的 AI 画像…")).not.toBeInTheDocument();
    expect(screen.queryByText("画像尚未建立")).not.toBeInTheDocument();
  });

  it("keeps the portrait retry until the reread finishes", async () => {
    let release: ((row: PortraitData) => void) | undefined;
    mockGetPortrait.mockRejectedValue(new Error("获取画像失败"));
    renderPortrait();
    const retry = await screen.findByRole("button", { name: "重试" });
    mockGetPortrait.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(retry);
    expect(retry).toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByTestId("portrait-load-error")).toHaveTextContent("获取画像失败");
    expect(screen.queryByText("正在生成你的 AI 画像…")).not.toBeInTheDocument();
    expect(screen.queryByText("画像尚未建立")).not.toBeInTheDocument();

    release?.({ profile: {}, habits: [], goals: [] });
    expect(await screen.findByText("画像尚未建立")).toBeInTheDocument();
    expect(screen.queryByTestId("portrait-load-error")).not.toBeInTheDocument();
  });

  it("shows empty state when no data available", async () => {
    mockPortraitData({ profile: {}, habits: [], goals: [] });
    renderPortrait();
    await waitFor(() => {
      expect(screen.getByText("画像尚未建立")).toBeInTheDocument();
    });
    expect(screen.getByText(/新用户通常在 5 分钟内/)).toBeInTheDocument();
  });

  it("renders profile categories with confidence bars", async () => {
    mockPortraitData({
      profile: {
        preferences: { data: { 编辑器: "VS Code", 主题: "暗色" }, confidence: 0.9 },
        values: { data: {}, confidence: 0.3 },
      },
      habits: [],
      goals: [],
    });
    renderPortrait();
    await waitFor(() => {
      expect(screen.getByText("偏好")).toBeInTheDocument();
      expect(screen.getByText("编辑器：")).toBeInTheDocument();
      expect(screen.getByText("VS Code")).toBeInTheDocument();
      expect(screen.getByText("90%")).toBeInTheDocument(); // 0.9 → 90%
    });
  });

  it("renders habits with confidence and origin", async () => {
    mockPortraitData({
      profile: {},
      habits: [
        {
          id: "h1",
          content: "每天早晨检查邮件",
          confidence: 0.85,
          source: "",
          origin: "claim",
          created_at: "2026-06-01T00:00:00Z",
        },
        {
          id: "h2",
          content: "午休后散步",
          confidence: 0.6,
          source: "",
          origin: "self_report",
          created_at: "2026-06-02T00:00:00Z",
        },
      ],
      goals: [],
    });
    renderPortrait();
    await waitFor(() => {
      expect(screen.getByText("每天早晨检查邮件")).toBeInTheDocument();
      expect(screen.getByText("午休后散步")).toBeInTheDocument();
      expect(screen.getByText("AI 推断")).toBeInTheDocument();
      expect(screen.getByText("来自你的告知")).toBeInTheDocument();
    });
  });

  it("renders goals with progress bars", async () => {
    mockPortraitData({
      profile: {},
      habits: [],
      goals: [
        {
          id: "g1",
          title: "完成项目文档",
          progress: 60,
          importance: 8,
          deadline: "2026-07-01",
          last_activity_at: null,
        },
        {
          id: "g2",
          title: "开始运动",
          progress: 0,
          importance: 5,
          deadline: null,
          last_activity_at: null,
        },
      ],
    });
    renderPortrait();
    await waitFor(() => {
      expect(screen.getByText("完成项目文档")).toBeInTheDocument();
      expect(screen.getByText("60%")).toBeInTheDocument();
      expect(screen.getByText("开始运动")).toBeInTheDocument();
      expect(screen.getByText("待开始")).toBeInTheDocument();
      expect(screen.getByText("截止: 2026-07-01")).toBeInTheDocument();
    });
  });

  it("renders header with total item count", async () => {
    mockPortraitData({
      profile: { preferences: { data: {}, confidence: 0.5 } },
      habits: [{ id: "h1", content: "test", confidence: 0.5, source: "", origin: "claim" }],
      goals: [
        {
          id: "g1",
          title: "test",
          progress: 0,
          importance: 1,
          deadline: null,
          last_activity_at: null,
        },
      ],
    });
    renderPortrait();
    await waitFor(() => {
      expect(screen.getByText(/包含 3 项洞察/)).toBeInTheDocument();
    });
  });

  it("gives the refresh retry the timeline focus ring", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockGetPortrait.mockResolvedValue({ profile: {}, habits: [], goals: [] });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PortraitPanel compact />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("画像尚未建立")).toBeInTheDocument();
    mockGetPortrait.mockRejectedValue(new Error("刷新失败"));
    await client.refetchQueries({ queryKey: queryKeys.portrait });
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(retry).toHaveClass("focus-visible:ring-focus-ring");
    expect(screen.getByText(/刷新失败/)).toBeInTheDocument();
    expect(screen.queryByTestId("portrait-load-error")).not.toBeInTheDocument();
  });
});
