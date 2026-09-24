import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import DataSovereigntyCard from "./DataSovereigntyCard";
import { ApiError, destroyAllData } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";

vi.mock("../../hooks/useSettingsQuery", () => ({
  useInvalidateSettings: () => vi.fn(),
}));

vi.mock("../../api/client", () => ({
  downloadExport: vi.fn(),
  exportEncryptedData: vi.fn(),
  importData: vi.fn(),
  importEncryptedData: vi.fn(),
  destroyAllData: vi.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

describe("DataSovereigntyCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useErrorStore.setState({ errors: [], backendUnavailable: false });
  });

  it("opens a confirm dialog and does not destroy until that confirm succeeds", async () => {
    let fail: (err: unknown) => void = () => {};
    vi.mocked(destroyAllData).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    renderWithRouter(<DataSovereigntyCard embedded />);
    const opener = screen.getByRole("button", { name: "销毁全部数据" });
    opener.focus();
    fireEvent.click(opener);
    expect(destroyAllData).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog", { name: "销毁全部数据" });
    expect(dialog).toHaveAccessibleDescription("确定销毁全部个人数据？此操作不可撤销！");
    expect(dialog).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "销毁" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "销毁中…" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const pending = await within(dialog).findByRole("button", { name: "销毁中…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(destroyAllData).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText("数据已销毁，请重新启动应用")).not.toBeInTheDocument();

    fail(new ApiError("销毁失败", 500));
    await waitFor(() =>
      expect(useErrorStore.getState().errors[0]).toMatchObject({
        message: "销毁失败",
        source: "设置",
      }),
    );
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "销毁" })).toBeEnabled();

    vi.mocked(destroyAllData).mockResolvedValueOnce({ status: "ok" });
    fireEvent.click(within(dialog).getByRole("button", { name: "销毁" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "销毁全部数据" })).not.toBeInTheDocument(),
    );
    expect(destroyAllData).toHaveBeenCalledTimes(2);
    expect(screen.getByText("数据已销毁，请重新启动应用")).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape before confirm and leaves the data in place", async () => {
    renderWithRouter(<DataSovereigntyCard embedded />);
    const opener = screen.getByRole("button", { name: "销毁全部数据" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "销毁全部数据" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(destroyAllData).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});
