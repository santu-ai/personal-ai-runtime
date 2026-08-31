import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useNotifications } from "./useNotifications";

vi.mock("../api/client", () => ({
  getAuthToken: vi.fn(() => null),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  protocols?: string | string[];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  fail() {
    this.onerror?.({});
    this.close();
  }
}

function Harness() {
  useNotifications();
  return null;
}

describe("useNotifications reconnect", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("still reconnects after more than five consecutive failures", () => {
    render(<Harness />);
    expect(MockWebSocket.instances).toHaveLength(1);

    for (let i = 0; i < 6; i += 1) {
      const current = MockWebSocket.instances[i];
      expect(current).toBeDefined();
      act(() => current.fail());
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }

    expect(MockWebSocket.instances.length).toBeGreaterThan(5);
  });

  it("reconnects immediately when the browser comes back online", () => {
    render(<Harness />);
    act(() => MockWebSocket.instances[0].fail());
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("cancels the reconnect timer on unmount", () => {
    const view = render(<Harness />);
    act(() => MockWebSocket.instances[0].fail());
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
