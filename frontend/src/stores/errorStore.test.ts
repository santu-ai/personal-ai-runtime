import { beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorStore } from "./errorStore";

describe("errorStore", () => {
  beforeEach(() => {
    useErrorStore.setState({ errors: [], backendUnavailable: false });
    vi.restoreAllMocks();
  });

  it("mirrors addError to the browser console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useErrorStore.getState().addError("invalid inbox JSON", "收件箱");
    expect(spy).toHaveBeenCalledWith("[收件箱] invalid inbox JSON");
    expect(useErrorStore.getState().errors[0]?.message).toBe("invalid inbox JSON");
  });
});
