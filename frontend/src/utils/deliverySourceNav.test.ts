import { describe, expect, it } from "vitest";
import {
  deliverySourceRowId,
  emailMessageId,
  findDeliverySource,
  scrollToDeliverySource,
} from "./deliverySourceNav";

const sources = [
  { id: "email:m1", type: "email", title: "延期邮件", locator: "a@example.com" },
  { id: "email:m10", type: "email", title: "另一封", locator: "b@example.com" },
  { id: "file:abc", type: "file", title: "纪要", locator: "C:\\notes\\a.md" },
  { id: "email:", type: "email", title: "空编号" },
  { id: "not-prefixed", type: "email", title: "无前缀" },
];

describe("delivery source id matching", () => {
  it("matches a cited id to the source row and ignores a longer prefix", () => {
    expect(findDeliverySource(sources, "email:m1")?.title).toBe("延期邮件");
    expect(findDeliverySource(sources, "  email:m1 ")?.id).toBe("email:m1");
    expect(findDeliverySource(sources, "email:m10")?.title).toBe("另一封");
    expect(findDeliverySource(sources, "email:missing")).toBeUndefined();
    expect(findDeliverySource(sources, "   ")).toBeUndefined();
    expect(findDeliverySource(sources, "file:abc")?.locator).toBe("C:\\notes\\a.md");
  });

  it("opens inbox only for type=email ids shaped email:{message_id}", () => {
    expect(emailMessageId(sources[0]!)).toBe("m1");
    expect(emailMessageId({ id: "email:msg:with:colon", type: "email" })).toBe("msg:with:colon");
    expect(emailMessageId(sources[2]!)).toBeNull();
    expect(emailMessageId(sources[3]!)).toBeNull();
    expect(emailMessageId(sources[4]!)).toBeNull();
    expect(emailMessageId({ id: "email:m1", type: "file" })).toBeNull();
  });

  it("builds a stable row id without treating the source id as a selector", () => {
    expect(deliverySourceRowId("email:m1", 0)).toBe("delivery-source-0-email%3Am1");
    expect(deliverySourceRowId("file:abc", 2)).toBe("delivery-source-2-file%3Aabc");
  });
});

describe("scrollToDeliverySource", () => {
  it("scrolls the matching source row and skips prefix collisions", () => {
    document.body.innerHTML = "";
    const file = document.createElement("li");
    file.setAttribute("data-delivery-source-id", "file:abc");
    const email = document.createElement("li");
    email.setAttribute("data-delivery-source-id", "email:m1");
    const longer = document.createElement("li");
    longer.setAttribute("data-delivery-source-id", "email:m10");
    document.body.append(file, email, longer);
    const scrolled: Array<{ el: HTMLElement; arg: ScrollIntoViewOptions | undefined }> = [];
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      scrolled.push({ el: this, arg: typeof arg === "object" ? arg : undefined });
    };

    try {
      expect(scrollToDeliverySource("file:abc")).toBe(true);
      expect(scrolled[0]?.el).toBe(file);
      expect(scrolled[0]?.arg).toEqual({ block: "center", inline: "nearest" });

      expect(scrollToDeliverySource("email:m1")).toBe(true);
      expect(scrolled[1]?.el).toBe(email);
      expect(scrolled.map((item) => item.el)).not.toContain(longer);

      expect(scrollToDeliverySource("email:missing")).toBe(false);
      expect(scrollToDeliverySource("  ")).toBe(false);
      expect(scrolled).toHaveLength(2);
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
      document.body.innerHTML = "";
    }
  });
});
