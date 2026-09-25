import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorStore } from "../stores/errorStore";
import { useDashboard } from "./useDashboard";

vi.mock("../api/client", () => ({
  getCostSummary: vi.fn(),
  getCostByModel: vi.fn(),
  getToolSummary: vi.fn(),
  getMemoryStats: vi.fn(),
  getHealth: vi.fn(),
  listNotifications: vi.fn(),
  getDashboard: vi.fn(),
}));

import {
  getCostByModel,
  getCostSummary,
  getDashboard,
  getHealth,
  getMemoryStats,
  getToolSummary,
  listNotifications,
} from "../api/client";

const readers = [
  vi.mocked(getCostSummary),
  vi.mocked(getCostByModel),
  vi.mocked(getToolSummary),
  vi.mocked(getMemoryStats),
  vi.mocked(getHealth),
  vi.mocked(listNotifications),
  vi.mocked(getDashboard),
];

function rejectAll(error: unknown) {
  for (const reader of readers) reader.mockRejectedValue(error);
}

function resolveAll() {
  vi.mocked(getCostSummary).mockResolvedValue({ total_calls: 1 } as never);
  vi.mocked(getCostByModel).mockResolvedValue([]);
  vi.mocked(getToolSummary).mockResolvedValue([]);
  vi.mocked(getMemoryStats).mockResolvedValue({ total_memories: 0 } as never);
  vi.mocked(getHealth).mockResolvedValue({ active_work_items: 0 } as never);
  vi.mocked(listNotifications).mockResolvedValue([]);
  vi.mocked(getDashboard).mockResolvedValue({ generated_at: "2026-09-24T00:00:00Z" } as never);
}

function hangAll() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(getCostSummary).mockImplementation(() =>
    gate.then(() => ({ total_calls: 1 }) as never),
  );
  vi.mocked(getCostByModel).mockImplementation(() => gate.then(() => []));
  vi.mocked(getToolSummary).mockImplementation(() => gate.then(() => []));
  vi.mocked(getMemoryStats).mockImplementation(() =>
    gate.then(() => ({ total_memories: 0 }) as never),
  );
  vi.mocked(getHealth).mockImplementation(() =>
    gate.then(() => ({ active_work_items: 0 }) as never),
  );
  vi.mocked(listNotifications).mockImplementation(() => gate.then(() => []));
  vi.mocked(getDashboard).mockImplementation(() =>
    gate.then(() => ({ generated_at: "2026-09-24T00:00:00Z" }) as never),
  );
  return release;
}

function Harness() {
  const dash = useDashboard();
  return (
    <div>
      <p data-testid="loading">{String(dash.loading)}</p>
      <p data-testid="error">{dash.error}</p>
      <p data-testid="busy">{String(dash.errorBusy)}</p>
      <p data-testid="fetching">{String(dash.fetching)}</p>
      <button type="button" onClick={() => dash.refresh()}>
        refresh
      </button>
    </div>
  );
}

function RefreshSettleHarness() {
  const dash = useDashboard();
  const [state, setState] = useState("idle");
  return (
    <button
      type="button"
      onClick={() => {
        setState("pending");
        void dash.refresh().then(() => setState("settled"));
      }}
    >
      {state}
    </button>
  );
}

function renderHarness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: 0, refetchOnWindowFocus: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<Harness />, { wrapper: Wrapper });
}

describe("useDashboard full-page failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useErrorStore.getState(), "addError").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the page fallback when every read fails without a message", async () => {
    rejectAll(new Error("   "));
    renderHarness();
    await waitFor(
      () => {
        expect(screen.getByTestId("error")).toHaveTextContent(
          "无法连接到后端服务，请确认后端已启动",
        );
      },
      { timeout: 4000 },
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("busy")).toHaveTextContent("false");
  });

  it("keeps the failure while a retry is in flight", async () => {
    rejectAll(new Error("后端连接失败"));
    renderHarness();
    await waitFor(
      () => {
        expect(screen.getByTestId("error")).toHaveTextContent("后端连接失败");
      },
      { timeout: 4000 },
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    const toasts = vi.mocked(useErrorStore.getState().addError).mock.calls.length;

    const release = hangAll();
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("true"));
    expect(screen.getByTestId("fetching")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent("后端连接失败");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(useErrorStore.getState().addError).toHaveBeenCalledTimes(toasts);

    release();
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(""));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("busy")).toHaveTextContent("false");
    expect(screen.getByTestId("fetching")).toHaveTextContent("false");
  });

  it("does not blank the page when one read still succeeds", async () => {
    rejectAll(new Error("后端连接失败"));
    vi.mocked(getDashboard).mockResolvedValue({ generated_at: "2026-09-24T00:00:00Z" } as never);
    renderHarness();
    await waitFor(() => expect(vi.mocked(getCostSummary)).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(screen.getByTestId("busy")).toHaveTextContent("false");
  });

  it("resolves refresh only after the dashboard reads settle", async () => {
    resolveAll();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retryDelay: 0, gcTime: 0, refetchOnWindowFocus: false },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    render(<RefreshSettleHarness />, { wrapper: Wrapper });
    await waitFor(() => expect(vi.mocked(getDashboard)).toHaveBeenCalled());
    const calls = vi.mocked(getDashboard).mock.calls.length;

    const release = hangAll();
    fireEvent.click(screen.getByRole("button", { name: "idle" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pending" })).toBeInTheDocument(),
    );
    expect(vi.mocked(getDashboard).mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole("button", { name: "settled" })).not.toBeInTheDocument();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settled" })).toBeInTheDocument(),
    );
  });

  it("clears a held failure after the next read succeeds", async () => {
    rejectAll(new Error("后端连接失败"));
    renderHarness();
    await waitFor(
      () => {
        expect(screen.getByTestId("error")).toHaveTextContent("后端连接失败");
      },
      { timeout: 4000 },
    );
    resolveAll();
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(""));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });
});
