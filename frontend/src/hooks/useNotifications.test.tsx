import { useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ToastCard from "../components/ui/ToastCard";
import { clearToastDismissFocus, placeToastDismissFocus } from "../utils/toastDismissFocus";
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

let focusAtLayout: Element | null = null;

function ToastHarness({ watchId }: { watchId: string }) {
  const { toasts, dismissToast } = useNotifications();
  const seen = useRef(false);
  useLayoutEffect(() => {
    placeToastDismissFocus();
    const present = toasts.some((item) => item.id === watchId);
    if (present) {
      seen.current = true;
      return;
    }
    if (seen.current) focusAtLayout ??= document.activeElement;
  });
  return (
    <>
      <button type="button" data-notification-bell="">
        通知
      </button>
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          toastId={item.id}
          tone="insight"
          title={item.title}
          body={item.content}
          onClick={() => {}}
          onDismiss={() => dismissToast(item.id)}
        />
      ))}
    </>
  );
}

function pushNotification(id: string, title: string) {
  const socket = MockWebSocket.instances[0];
  act(() => {
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "notification",
        id,
        title,
        content: "内容",
        created_at: "2026-09-26T00:00:00.000Z",
        notification_type: "reminder",
      }),
    });
  });
}

describe("useNotifications toast dismiss focus", () => {
  beforeEach(() => {
    focusAtLayout = null;
    clearToastDismissFocus();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    clearToastDismissFocus();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves focus to the bell in the same layout turn when the only toast times out", () => {
    render(<ToastHarness watchId="n1" />);
    pushNotification("n1", "喝水");
    screen.getByRole("button", { name: /喝水/ }).focus();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    const bell = screen.getByRole("button", { name: "通知" });
    expect(bell).toHaveFocus();
    expect(focusAtLayout).toBe(bell);
    expect(screen.queryByText("喝水")).not.toBeInTheDocument();
  });

  it("does not steal the bell when a toast times out while focus is already there", () => {
    render(<ToastHarness watchId="n1" />);
    pushNotification("n1", "喝水");
    const bell = screen.getByRole("button", { name: "通知" });
    bell.focus();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(bell).toHaveFocus();
    expect(focusAtLayout).toBe(bell);
  });

  it("moves focus to the next close button when a newer toast is dismissed", () => {
    render(<ToastHarness watchId="n2" />);
    pushNotification("n1", "先到");
    pushNotification("n2", "后到");
    const close = screen.getAllByRole("button", { name: "关闭" })[0];
    expect(close).toBeDefined();
    close?.focus();
    fireEvent.click(close!);
    const remaining = screen.getByRole("button", { name: "关闭" });
    expect(remaining).toHaveFocus();
    expect(focusAtLayout).toBe(remaining);
    expect(screen.getByText("先到")).toBeInTheDocument();
    expect(screen.queryByText("后到")).not.toBeInTheDocument();
  });
});
