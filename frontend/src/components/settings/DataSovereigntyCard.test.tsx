import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import DataSovereigntyCard from "./DataSovereigntyCard";
import {
  ApiError,
  destroyAllData,
  downloadExport,
  exportEncryptedData,
  importEncryptedData,
} from "../../api/client";
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
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
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

  it("does not export twice and keeps focus on 导出全部数据", async () => {
    let release: (() => void) | undefined;
    vi.mocked(downloadExport).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<DataSovereigntyCard embedded />);
    const save = screen.getByRole("button", { name: "导出全部数据" });
    const other = screen.getByRole("button", { name: "加密导出" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(downloadExport).toHaveBeenCalledTimes(1);
    expect(save).toHaveTextContent("导出中…");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(other).toBeDisabled();
    expect(other).not.toHaveAttribute("aria-busy");

    await act(async () => {
      release?.();
    });
    expect(await screen.findByTestId("export-notice")).toHaveTextContent("已导出");
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("keeps focus on 导出全部数据 when export fails", async () => {
    vi.mocked(downloadExport).mockRejectedValueOnce(new ApiError("导出失败", 500));
    renderWithRouter(<DataSovereigntyCard embedded />);
    const save = screen.getByRole("button", { name: "导出全部数据" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() =>
      expect(useErrorStore.getState().errors[0]).toMatchObject({
        message: "导出失败",
        source: "设置",
      }),
    );
    expect(screen.queryByTestId("export-notice")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  it("does not steal focus after 导出全部数据 returns", async () => {
    let release: (() => void) | undefined;
    vi.mocked(downloadExport).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<DataSovereigntyCard embedded />);
    const save = screen.getByRole("button", { name: "导出全部数据" });
    const field = screen.getByPlaceholderText("输入加密密码");
    save.focus();
    fireEvent.click(save);
    field.focus();
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.getByTestId("export-notice")).toHaveTextContent("已导出");
    expect(field).toHaveFocus();
  });

  it("does not encrypt-export twice and keeps focus on 加密导出", async () => {
    let release: ((row: { format: string; data: string }) => void) | undefined;
    vi.mocked(exportEncryptedData).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    const save = screen.getByRole("button", { name: "加密导出" });
    const other = screen.getByRole("button", { name: "导出全部数据" });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "secret" } });
    expect(save).toBeEnabled();
    save.focus();
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(other);
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(exportEncryptedData).toHaveBeenCalledTimes(1);
    expect(exportEncryptedData).toHaveBeenCalledWith("secret");
    expect(downloadExport).not.toHaveBeenCalled();
    expect(save).toHaveTextContent("加密导出中…");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-busy");

    field.focus();
    fireEvent.change(field, { target: { value: "" } });
    expect(save).toBeEnabled();
    expect(save).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      release?.({ format: "enc", data: "abc" });
    });
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByTestId("encrypt-export-notice")).not.toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(save).toBeDisabled();
  });

  it("writes 已导出 beside 加密导出 and keeps the password", async () => {
    vi.mocked(exportEncryptedData).mockResolvedValueOnce({ format: "enc", data: "abc" });
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    fireEvent.change(field, { target: { value: "secret" } });
    const save = screen.getByRole("button", { name: "加密导出" });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByTestId("encrypt-export-notice")).toHaveTextContent("已导出");
    expect(save).toHaveFocus();
    expect(save).toBeEnabled();
    expect(field).toHaveValue("secret");
  });

  it("keeps the password and focus on 加密导出 when encrypted export fails", async () => {
    vi.mocked(exportEncryptedData).mockRejectedValueOnce(new ApiError("加密导出失败", 500));
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    fireEvent.change(field, { target: { value: "secret" } });
    const save = screen.getByRole("button", { name: "加密导出" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() =>
      expect(useErrorStore.getState().errors[0]).toMatchObject({
        message: "加密导出失败",
        source: "设置",
      }),
    );
    expect(screen.queryByTestId("encrypt-export-notice")).not.toBeInTheDocument();
    expect(field).toHaveValue("secret");
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
    expect(save).not.toHaveAttribute("aria-busy");
  });

  function encryptedImportInput() {
    const input = document.querySelector<HTMLInputElement>(
      'input[data-sovereignty-import="encrypted"]',
    );
    if (!input) throw new Error("missing encrypted import input");
    return input;
  }

  it("clears an unchanged password after encrypted import succeeds", async () => {
    vi.mocked(importEncryptedData).mockResolvedValueOnce({});
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    fireEvent.change(field, { target: { value: "secret" } });
    const file = new File([JSON.stringify({ data: "blob", password: "secret" })], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(encryptedImportInput(), { target: { files: [file] } });
    expect(await screen.findByText("加密导入成功")).toBeInTheDocument();
    expect(importEncryptedData).toHaveBeenCalledWith("blob", "secret");
    expect(field).toHaveValue("");
  });

  it("keeps the password when encrypted import fails", async () => {
    vi.mocked(importEncryptedData).mockRejectedValueOnce(new Error("bad"));
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    fireEvent.change(field, { target: { value: "secret" } });
    const file = new File([JSON.stringify({ data: "blob", password: "secret" })], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(encryptedImportInput(), { target: { files: [file] } });
    await waitFor(() =>
      expect(useErrorStore.getState().errors[0]).toMatchObject({
        message: "加密导入失败，请检查密码和文件",
        source: "设置",
      }),
    );
    expect(importEncryptedData).toHaveBeenCalledTimes(1);
    expect(importEncryptedData).toHaveBeenCalledWith("blob", "secret");
    expect(field).toHaveValue("secret");
    expect(screen.queryByText("加密导入成功")).not.toBeInTheDocument();
  });

  it("does not import an encrypted backup twice and keeps a password typed during import", async () => {
    let release: ((row: Record<string, unknown>) => void) | undefined;
    vi.mocked(importEncryptedData).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderWithRouter(<DataSovereigntyCard embedded />);
    const field = screen.getByPlaceholderText("输入加密密码");
    fireEvent.change(field, { target: { value: "secret" } });
    const file = new File([JSON.stringify({ data: "blob" })], "backup.json", {
      type: "application/json",
    });
    const input = encryptedImportInput();
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(importEncryptedData).toHaveBeenCalledTimes(1));
    expect(importEncryptedData).toHaveBeenCalledWith("blob", "secret");
    field.focus();
    fireEvent.change(field, { target: { value: "next" } });
    await act(async () => {
      release?.({});
    });
    expect(await screen.findByText("加密导入成功")).toBeInTheDocument();
    expect(field).toHaveValue("next");
    expect(field).toHaveFocus();
  });
});
