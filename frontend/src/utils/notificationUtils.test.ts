import { describe, expect, it } from "vitest";
import { notificationPreview, notificationRowName } from "./notificationUtils";

describe("notificationPreview", () => {
  it("strips a related-id prefix and the space after it", () => {
    expect(notificationPreview("[[related:work_1]] 正文")).toBe("正文");
    expect(notificationPreview("[[RELATED:abc]]\n后面")).toBe("后面");
  });
});

describe("notificationRowName", () => {
  it("prefixes 未读 or 已读 and keeps the title and body", () => {
    expect(notificationRowName("待审批", "写入文件需要确认", 0)).toBe(
      "未读 待审批 写入文件需要确认",
    );
    expect(notificationRowName("待审批", "写入文件需要确认", undefined)).toBe(
      "未读 待审批 写入文件需要确认",
    );
    expect(notificationRowName("待审批", "写入文件需要确认", 1)).toBe(
      "已读 待审批 写入文件需要确认",
    );
  });

  it("trims the edges and keeps spaces and line breaks in the middle", () => {
    expect(notificationRowName("  前  后  ", " \n 正文 \n ", 0)).toBe("未读 前  后 正文");
    expect(notificationRowName("前\n后", "a  b", 0)).toBe("未读 前\n后 a  b");
  });

  it("drops a blank title or body and a related-id prefix", () => {
    expect(notificationRowName("   ", "[[related:work_1]] 只剩正文", 0)).toBe("未读 只剩正文");
    expect(notificationRowName("只有标题", "[[related:work_1]]", 1)).toBe("已读 只有标题");
    expect(notificationRowName("  ", "[[related:work_1]]   ", null)).toBe("未读");
    expect(notificationRowName("", "", 1)).toBe("已读");
  });
});
