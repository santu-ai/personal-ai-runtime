import { describe, expect, it } from "vitest";
import { deniedOperationNote } from "./useApprovalFlow";

describe("deniedOperationNote", () => {
  it("uses the same Chinese name as the confirmation card", () => {
    expect(deniedOperationNote("write_file")).toBe("已拒绝「写入文件」，没有执行该操作。");
    expect(deniedOperationNote("ask_user")).toBe("已拒绝「向你确认」，没有执行该操作。");
  });

  it("uses the plain sentence when the tool has no name", () => {
    expect(deniedOperationNote("")).toBe("已拒绝该操作。");
    expect(deniedOperationNote("   ")).toBe("已拒绝该操作。");
  });
});
