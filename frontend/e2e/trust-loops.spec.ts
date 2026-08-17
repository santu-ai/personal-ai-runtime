import { test, expect } from "@playwright/test";
import { installMocks, E2E_CONV_ID } from "./helpers";

const NEW_CONV = "e2e-home-conv";

test.describe("Trust loops", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  });

  test("home composer creates a chat and sends the prompt", async ({ page }) => {
    const created = {
      id: NEW_CONV,
      title: "讨论「帮我规划今天」",
      summary: null,
      created_at: "2026-08-17T00:00:00Z",
      updated_at: "2026-08-17T00:00:00Z",
    };
    const existing = {
      id: E2E_CONV_ID,
      title: "测试对话",
      summary: null,
      created_at: "2026-06-10T00:00:00Z",
      updated_at: "2026-06-10T00:00:00Z",
    };
    let didCreate = false;
    await installMocks(page, (router) => {
      router.handler("/api/chat/conversations", async (route) => {
        if (route.request().method() === "POST") {
          didCreate = true;
          await route.fulfill({ json: created });
          return;
        }
        if (route.request().method() === "GET") {
          await route.fulfill({ json: didCreate ? [created, existing] : [existing] });
          return;
        }
        await route.continue();
      });
      router.handler(`/api/chat/conversations/${NEW_CONV}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"text_delta","content":"好的，开始规划。"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(/输入消息/).fill("帮我规划今天");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${NEW_CONV}$`), { timeout: 10000 });
    await expect(page.getByRole("main").getByText("好的，开始规划。")).toBeVisible({
      timeout: 10000,
    });
  });

  test("reloading a chat restores a persisted approval card", async ({ page }) => {
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${E2E_CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            json: [
              {
                id: "u1",
                conversation_id: E2E_CONV_ID,
                role: "user",
                content: "请写入一个文件",
                tool_calls: null,
                tool_call_id: null,
                created_at: "2026-08-17T00:00:00Z",
              },
              {
                id: "a1",
                conversation_id: E2E_CONV_ID,
                role: "assistant",
                content: "",
                tool_calls: JSON.stringify([
                  {
                    id: "tc-persist",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({ path: "/tmp/e2e.txt", content: "hello" }),
                    },
                  },
                ]),
                tool_call_id: null,
                created_at: "2026-08-17T00:00:01Z",
              },
            ],
          });
          return;
        }
        await route.continue();
      });
      router.json("/api/approvals", [
        {
          id: "ap-persist",
          action: "write_file",
          status: "pending",
          params: JSON.stringify({ path: "/tmp/e2e.txt", content: "hello" }),
          created_at: "2026-08-17T00:00:01Z",
          flow_type: "对话",
          flow_label: "测试对话",
          correlation_id: "corr-persist",
          conversation_id: E2E_CONV_ID,
          tool_call_id: "tc-persist",
        },
      ]);
    });

    await page.goto(`/chat/${E2E_CONV_ID}`);
    await expect(page.getByText(/建议：写入文件/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "确认写入" })).toBeVisible();
  });

  test("inbox sync failure shows retry and recovers after poll", async ({ page }) => {
    let allowSuccess = false;
    const errorStatus = {
      status: "error",
      error: "connection timed out",
      error_kind: "imap",
      new_count: 0,
      synced_read: 0,
      duplicate_count: 0,
      classification_fallback: 0,
      synced_at: new Date().toISOString(),
      event_id: "evt-err",
      metrics: {
        days: 7,
        poll_count: 1,
        requested_count: 1,
        error_count: 1,
        errors_by_kind: { imap: 1 },
        new_count: 0,
        duplicate_count: 0,
        synced_read: 0,
        classification_fallback: 0,
        rapid_repeat_polls: 0,
      },
    };
    const okStatus = {
      status: "ok",
      error: null,
      error_kind: null,
      new_count: 1,
      synced_read: 0,
      duplicate_count: 0,
      classification_fallback: 0,
      synced_at: new Date().toISOString(),
      event_id: "evt-ok",
      metrics: {
        days: 7,
        poll_count: 2,
        requested_count: 2,
        error_count: 1,
        errors_by_kind: { imap: 1 },
        new_count: 1,
        duplicate_count: 0,
        synced_read: 0,
        classification_fallback: 0,
        rapid_repeat_polls: 0,
      },
    };
    await installMocks(page, (router) => {
      router.handler("/api/inbox/sync-status", async (route) => {
        await route.fulfill({ json: allowSuccess ? okStatus : errorStatus });
      });
      router.handler("/api/inbox/poll", async (route) => {
        if (!allowSuccess) {
          await route.fulfill({ json: { status: "error", error: "connection timed out" } });
          return;
        }
        await route.fulfill({ json: { status: "ok", new_count: 1 } });
      });
    });

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-sync-status")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/IMAP 错误/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重试同步" })).toBeVisible();
    allowSuccess = true;
    await page.getByRole("button", { name: "重试同步" }).click();
    await expect(page.getByText(/同步成功/)).toBeVisible({ timeout: 10000 });
  });

  test("confirming a proposed memory lets it appear in chat context", async ({ page }) => {
    let ratified = false;
    await installMocks(page, (router) => {
      router.handler("/api/memory/memories/count", async (route) => {
        await route.fulfill({ json: { count: ratified ? 0 : 1 } });
      });
      router.handler("/api/memory/memories/grouped", async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("claim_status") === "proposed") {
          await route.fulfill({
            json: ratified
              ? { memories: [], total: 0 }
              : {
                  memories: [{ id: "mem-proposed", content: "喜欢早起跑步", confidence: 0.8 }],
                  total: 1,
                },
          });
          return;
        }
        await route.fulfill({
          json: {
            memories: [{ id: "mem-1", content: "用户喜欢喝咖啡", category: "偏好" }],
            total: 1,
          },
        });
      });
      router.handler("/api/memory/memories/mem-proposed/ratify", async (route) => {
        ratified = true;
        await route.fulfill({ json: { status: "ok", claim_status: "ratified" } });
      });
      router.handler("/api/memory/memories/search", async (route) => {
        await route.fulfill({
          json: ratified ? [{ id: "mem-proposed", content: "喜欢早起跑步" }] : [],
        });
      });
      router.handler(`/api/chat/conversations/${E2E_CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            json: [
              {
                id: "u1",
                conversation_id: E2E_CONV_ID,
                role: "user",
                content: "我早上一般做什么",
                tool_calls: null,
                tool_call_id: null,
                created_at: "2026-08-17T00:00:00Z",
              },
            ],
          });
          return;
        }
        await route.continue();
      });
    });

    await page.goto("/");
    await expect(page.getByText(/1 条记忆待确认后才会进入对话/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "确认" }).click();
    await expect(page.getByText(/待确认后才会进入对话/)).toHaveCount(0, { timeout: 10000 });

    await page.goto(`/chat/${E2E_CONV_ID}`);
    await page.getByRole("button", { name: "上下文" }).click();
    await expect(page.getByText("喜欢早起跑步")).toBeVisible({ timeout: 10000 });
  });
});
