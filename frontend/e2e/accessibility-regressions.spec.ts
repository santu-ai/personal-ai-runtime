import { expect, test } from "@playwright/test";
import { installMocks } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  await installMocks(page, (router) => {
    router.handler("/api/memory/memories", async (route) => {
      await route.fulfill({
        json:
          route.request().method() === "POST"
            ? { id: "captured", status: "ok" }
            : { memories: [], total: 0 },
      });
    });
  });
});

test("quick capture owns Tab and Escape above an existing dialog", async ({ page }) => {
  await page.goto("/");
  const opener = page.locator("[data-conversation-delete]").first();
  await opener.focus();
  await opener.press("Enter");
  const lower = page.getByRole("dialog", { name: "删除对话" });
  await expect(lower).toBeVisible();
  await page.keyboard.press("Control+Shift+m");
  const upper = page.getByRole("dialog", { name: "快速捕获" });
  const field = upper.getByRole("textbox");
  await expect(field).toBeFocused();
  await field.fill("键盘回归测试");
  await page.keyboard.press("Tab");
  await expect(upper.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(upper.getByRole("button", { name: "保存", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const save = upper.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeFocused();
  // 键盘拥有者必须也在视觉上最上面，不能把焦点交给被旧对话框挡住的控件。
  await expect(save).toBeInViewport();
  await expect(save).toBeVisible();
  await save.click({ trial: true });
  await page.keyboard.press("Escape");
  await expect(upper).toHaveCount(0);
  await expect(lower).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(lower.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lower).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("a newly mounted status region is empty before its message arrives", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "输入消息" })).toBeVisible();
  await page.keyboard.press("Control+Shift+m");
  const dialog = page.getByRole("dialog", { name: "快速捕获" });
  await dialog.getByRole("textbox").fill("状态区域回归测试");
  const firstStatusText = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              const status = node.matches('[role="status"]')
                ? node
                : node.querySelector('[role="status"]');
              if (status) {
                observer.disconnect();
                resolve(status.textContent ?? "");
                return;
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }),
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect(await firstStatusText).toBe("");
  await expect(dialog.getByRole("status")).toHaveText("已保存");
});
