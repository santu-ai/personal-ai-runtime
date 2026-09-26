import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ToastCard from "../components/ui/ToastCard";
import {
  captureToastDismissFocus,
  clearToastDismissFocus,
  placeToastDismissFocus,
} from "./toastDismissFocus";

function Stack({ ids, outside = false }: { ids: readonly string[]; outside?: boolean }) {
  return (
    <>
      {ids.map((id) => (
        <ToastCard
          key={id}
          toastId={id}
          tone="insight"
          title={id}
          body="内容"
          onClick={() => {}}
          onDismiss={() => {}}
        />
      ))}
      <button type="button" data-notification-bell="">
        通知
      </button>
      {outside ? <button type="button">别处</button> : null}
    </>
  );
}

describe("toastDismissFocus", () => {
  afterEach(() => {
    clearToastDismissFocus();
  });

  it("moves dismiss focus to the next toast", () => {
    const view = render(<Stack ids={["甲", "乙"]} />);
    const closes = screen.getAllByRole("button", { name: "关闭" });
    closes[0]?.focus();
    captureToastDismissFocus("甲");
    view.rerender(<Stack ids={["乙"]} />);
    placeToastDismissFocus();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("moves dismiss focus to the previous toast when the last one closes", () => {
    const view = render(<Stack ids={["甲", "乙"]} />);
    const closes = screen.getAllByRole("button", { name: "关闭" });
    closes[1]?.focus();
    captureToastDismissFocus("乙");
    view.rerender(<Stack ids={["甲"]} />);
    placeToastDismissFocus();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("moves open focus to the notification bell when no toast remains", () => {
    const view = render(<Stack ids={["甲"]} />);
    screen.getByRole("button", { name: /甲/ }).focus();
    captureToastDismissFocus("甲");
    view.rerender(<Stack ids={[]} />);
    placeToastDismissFocus();
    expect(screen.getByRole("button", { name: "通知" })).toHaveFocus();
  });

  it("does not steal focus that already moved away", () => {
    const view = render(<Stack ids={["甲", "乙"]} outside />);
    screen.getAllByRole("button", { name: "关闭" })[0]?.focus();
    captureToastDismissFocus("甲");
    screen.getByRole("button", { name: "别处" }).focus();
    view.rerender(<Stack ids={["乙"]} outside />);
    placeToastDismissFocus();
    expect(screen.getByRole("button", { name: "别处" })).toHaveFocus();
  });
});
