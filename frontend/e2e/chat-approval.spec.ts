import { test, expect, type Page } from "@playwright/test";
import { MockApiRouter, buildCommonMocks, installMocks, E2E_CONV_ID } from "./helpers";

const CONV_ID = E2E_CONV_ID;

test.describe("Navigation and pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
    await installMocks(page);
  });

  test("home page shows sidebar and navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText("Personal AI")).toBeVisible({ timeout: 10000 });
    // 会话标题和「继续上次」也会带上「对话」字样。主导航在侧栏第一个 nav 里，名称必须完全等于「对话」。
    const chatNav = page
      .locator("aside nav")
      .first()
      .getByRole("link", { name: "对话", exact: true });
    await expect(chatNav).toBeVisible();
    await expect(chatNav).toHaveCount(1);
  });

  test("navigation to goals page lists goals", async ({ page }) => {
    await page.goto("/goals");
    await expect(page).toHaveURL(/\/goals/);
    // 目标标题若带上导航词「目标」，定位收到主内容，避免和侧栏撞名。
    const goal = page.getByRole("main").getByRole("link", { name: /学习 Rust/ });
    await expect(goal).toBeVisible({ timeout: 5000 });
    await expect(goal).toHaveAttribute("href", "/goals/goal-1");
  });

  test("navigation to memories page shows memories", async ({ page }) => {
    await page.goto("/memories");
    await expect(page).toHaveURL(/\/memories/);
    await expect(page.getByText("用户喜欢喝咖啡")).toBeVisible({ timeout: 5000 });
  });

  test("dashboard page loads with overview", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "今天", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("今天要做")).toBeVisible();
  });

  test("settings page shows export button", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "数据主权" })).toBeVisible({
      timeout: 5000,
    });
    // Data sovereignty is collapsed by default — expand before asserting content.
    await page.getByRole("button", { name: /数据主权/ }).click();
    await expect(page.getByText("导出全部数据")).toBeVisible();
  });

  test("approvals page shows empty state", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByText("审批管理")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/暂无待审批/)).toBeVisible();
  });
});

test.describe("Chat flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
    await installMocks(page);
  });

  test("chat input and send button present on conversation page", async ({ page }) => {
    await page.goto(`/chat/${CONV_ID}`);
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  });
});

test.describe("Chat approval flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  });

  test("shows confirmation dialog and resolves approval", async ({ page }) => {
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"confirmation_required","tool_name":"write_file","tool_args":{"path":"/tmp/e2e.txt","content":"hello"},"approval_id":"ap-e2e-1","tool_call_id":"tc-e2e-1"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
      router.handler("/api/chat/approvals/ap-e2e-1/resolve", async (route) => {
        await route.fulfill({ json: { status: "approved", result: '{"ok":true}' } });
      });
    });

    await page.goto(`/chat/${CONV_ID}`);
    await page.getByPlaceholder(/输入消息/).fill("请写入一个文件");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: "确认写入" }).click();
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("approve can present a second confirmation without sending again", async ({ page }) => {
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"confirmation_required","tool_name":"write_file","tool_args":{"path":"/tmp/e2e.txt","content":"hello"},"approval_id":"ap-e2e-1","tool_call_id":"tc-e2e-1"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
      router.handler("/api/chat/approvals/ap-e2e-1/resolve", async (route) => {
        await route.fulfill({
          json: {
            status: "approved",
            result: '{"ok":true}',
            assistant_message: "还需要再写一份。",
            pending: true,
            tool_name: "write_file",
            tool_args: { path: "/tmp/e2e-2.txt", content: "hello" },
            approval_id: "ap-e2e-3",
            tool_call_id: "tc-e2e-3",
          },
        });
      });
      router.handler("/api/chat/approvals/ap-e2e-3/resolve", async (route) => {
        await route.fulfill({
          json: { status: "approved", result: '{"ok":true}', assistant_message: "两份都写好了。" },
        });
      });
    });

    await page.goto(`/chat/${CONV_ID}`);
    await page.getByPlaceholder(/输入消息/).fill("请写入两个文件");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: "确认写入" }).click();
    await expect(page.getByText("还需要再写一份。")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "确认写入" })).toBeVisible();
    await page.getByRole("button", { name: "确认写入" }).click();
    await expect(page.getByText("两份都写好了。")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("switching conversations does not leak the pending confirmation", async ({ page }) => {
    const otherId = "e2e-conv-2";
    await installMocks(page, (router) => {
      router.handler("/api/chat/conversations", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith("/cancel") && route.request().method() === "POST") {
          await route.fulfill({ json: { status: "ok", cancelled: 0 } });
          return;
        }
        if (route.request().method() === "GET") {
          await route.fulfill({
            json: [
              {
                id: CONV_ID,
                title: "待审批对话",
                summary: null,
                created_at: "2026-06-10T00:00:00Z",
                updated_at: "2026-06-10T00:00:00Z",
              },
              {
                id: otherId,
                title: "另一段对话",
                summary: null,
                created_at: "2026-06-10T00:00:00Z",
                updated_at: "2026-06-10T00:00:00Z",
              },
            ],
          });
          return;
        }
        await route.continue();
      });
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            json: [
              {
                id: "u1",
                conversation_id: CONV_ID,
                role: "user",
                content: "请写入一个文件",
                tool_calls: null,
                tool_call_id: null,
                created_at: "2026-08-17T00:00:00Z",
              },
              {
                id: "a1",
                conversation_id: CONV_ID,
                role: "assistant",
                content: "",
                tool_calls: JSON.stringify([
                  {
                    id: "tc-persist",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({ path: "/tmp/x" }),
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
      router.handler(`/api/chat/conversations/${otherId}/messages`, async (route) => {
        await route.fulfill({ json: [] });
      });
      router.json("/api/approvals", [
        {
          id: "ap-persist",
          action: "write_file",
          status: "pending",
          conversation_id: CONV_ID,
          tool_call_id: "tc-persist",
          params: JSON.stringify({ path: "/tmp/x" }),
        },
      ]);
    });

    await page.goto(`/chat/${CONV_ID}`);
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).toBeVisible({
      timeout: 10000,
    });
    await page.getByText("另一段对话").click();
    await expect(page).toHaveURL(new RegExp(`/chat/${otherId}`));
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).not.toBeVisible({
      timeout: 5000,
    });
    await page.getByText("待审批对话").click();
    await expect(page).toHaveURL(new RegExp(`/chat/${CONV_ID}`));
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).toBeVisible({
      timeout: 10000,
    });
  });

  test("user can deny pending tool approval", async ({ page }) => {
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"confirmation_required","tool_name":"write_file","tool_args":{"path":"/tmp/e2e.txt","content":"hello"},"approval_id":"ap-e2e-2","tool_call_id":"tc-e2e-2"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
      router.handler("/api/chat/approvals/ap-e2e-2/resolve", async (route) => {
        await route.fulfill({ json: { status: "denied" } });
      });
    });

    await page.goto(`/chat/${CONV_ID}`);
    await page.getByPlaceholder(/输入消息/).fill("请写入一个文件");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("heading", { name: /建议：写入文件/ })).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("ask_user card sends the typed answer and continues the chat", async ({ page }) => {
    let resolveBody: Record<string, unknown> | null = null;
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"confirmation_required","tool_name":"ask_user","tool_args":{"question":"你想先看哪一周？","context":"用来对比完成情况"},"approval_id":"ap-ask-1","tool_call_id":"tc-ask-1"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
      router.handler("/api/chat/approvals/ap-ask-1/resolve", async (route) => {
        resolveBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          json: {
            status: "approved",
            result: '{"status":"answered","answer":"最近三天"}',
            assistant_message: "好，按最近三天继续。",
          },
        });
      });
    });

    await page.goto(`/chat/${CONV_ID}`);
    await page.getByPlaceholder(/输入消息/).fill("帮我对比一下");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("heading", { name: "需要你补充一点信息" })).toBeVisible({
      timeout: 10000,
    });
    // RiskCard repeats the question on a titled summary. The polite live region repeats both sentences.
    await expect(
      page.locator("p:not([title]):not([role=status])", { hasText: "你想先看哪一周？" }),
    ).toHaveText("你想先看哪一周？");
    await expect(
      page.locator("p:not([title]):not([role=status])", { hasText: "用来对比完成情况" }),
    ).toHaveText("用来对比完成情况");
    const sendAnswer = page.getByRole("button", { name: "发送回答" });
    await expect(sendAnswer).toBeDisabled();
    await page.getByRole("textbox", { name: "你的回答" }).fill("最近三天");
    await expect(sendAnswer).toBeEnabled();
    await sendAnswer.click();
    await expect(page.getByText("好，按最近三天继续。")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "需要你补充一点信息" })).not.toBeVisible();
    expect(resolveBody).toMatchObject({
      decision: "approve",
      tool_name: "ask_user",
      answer: "最近三天",
      conv_id: CONV_ID,
      tool_call_id: "tc-ask-1",
    });
  });

  test("cancelling ask_user clears the card without an answer", async ({ page }) => {
    let resolveBody: Record<string, unknown> | null = null;
    await installMocks(page, (router) => {
      router.handler(`/api/chat/conversations/${CONV_ID}/messages`, async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({ json: [] });
          return;
        }
        const sse =
          'data: {"type":"confirmation_required","tool_name":"ask_user","tool_args":{"question":"要不要先定范围？"},"approval_id":"ap-ask-2","tool_call_id":"tc-ask-2"}\n\n' +
          'data: {"type":"done"}\n\n';
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: sse,
        });
      });
      router.handler("/api/chat/approvals/ap-ask-2/resolve", async (route) => {
        resolveBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: { status: "denied" } });
      });
    });

    await page.goto(`/chat/${CONV_ID}`);
    await page.getByPlaceholder(/输入消息/).fill("帮我对比一下");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("heading", { name: "需要你补充一点信息" })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("heading", { name: "需要你补充一点信息" })).not.toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByRole("paragraph").filter({ hasText: "已拒绝「向你确认」，没有执行该操作。" }),
    ).toBeVisible();
    expect(resolveBody).toMatchObject({
      decision: "deny",
      tool_name: "ask_user",
    });
    expect(resolveBody && "answer" in resolveBody).toBe(false);
  });
});

test.describe("Today period comparison", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  });

  test("renders comparison fields from the periods endpoint", async ({ page }) => {
    let requested = "";
    await installMocks(page, (router) => {
      router.handler("/api/dashboard/periods", async (route) => {
        requested = route.request().url();
        await route.fulfill({
          json: {
            days: 7,
            current: { start: "2026-09-15T00:00:00+00:00", end: "2026-09-22T00:00:00+00:00" },
            previous: { start: "2026-09-08T00:00:00+00:00", end: "2026-09-15T00:00:00+00:00" },
            signals: {
              goals_completed: { current: 4, previous: 1, delta: 3 },
              tasks_completed: { current: 2, previous: 2, delta: 0 },
              work_completed_untyped: { current: 0, previous: 0, delta: 0 },
              inbox_recorded: { current: 9, previous: 12, delta: -3 },
              adoption_decided: { current: 6, previous: 4, delta: 2 },
              adoption_rate: { current: 0.5, previous: 0.25, delta: 0.25 },
            },
            capped: true,
          },
        });
      });
    });

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const card = page.getByTestId("period-comparison");
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText("近 7 日 vs 前 7 日");
    await expect(card).toContainText("完成目标");
    await expect(card).toContainText("+3");
    await expect(card).toContainText("完成任务");
    await expect(card).toContainText("持平");
    await expect(card).toContainText("新邮件");
    await expect(card).toContainText("-3");
    await expect(card).toContainText("50%");
    await expect(card).toContainText("+25 个百分点");
    await expect(card).toContainText("近 7 日 6 次拍板 / 前 7 日 4 次");
    await expect(card).toContainText("这段时间事件较多，数字可能不完整");
    expect(requested).toContain("/api/dashboard/periods?days=7");
  });
});

test.describe("Error handling", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  });

  test("dashboard shows error state on API failure", async ({ page }) => {
    const router = new MockApiRouter()
      .json("/api/system/health", { status: "ok", service: "personal-ai", auth_required: false })
      .json("/api/system/info", { conversations: 0, goals: 0, memories: 0, messages: 0 })
      .json("/api/work-items", [])
      .json("/api/memory/memories/grouped", { memories: [] })
      .json("/api/memory/memories/search", [])
      .json("/api/settings/llm", {
        config: { providers: [], default_provider: "deepseek", temperature: 0.7, max_tokens: 4096 },
      })
      .json("/api/settings/email", {
        config: { user: "", password: "", imap_host: "", smtp_host: "" },
      })
      .json("/api/approvals", [])
      .json("/api/system/llm-providers", { providers: [], default: "deepseek-chat" })
      .json("/api/system/mcp-status", { enabled: false, servers: [], total_tools: 0 })
      .handler("/api/chat/conversations", async (route) => {
        await route.fulfill({ json: [] });
      })
      .handler("/api/notifications", async (route) => {
        await route.fulfill({ status: 500, body: "Internal Server Error" });
      })
      .handler("/api/dashboard", async (route) => {
        await route.fulfill({ status: 500, body: "Internal Server Error" });
      })
      .handler("/api/telemetry/cost/summary", async (route) => {
        await route.fulfill({ status: 500, body: "Internal Server Error" });
      })
      .handler("/api/telemetry/cost/by-model", async (route) => {
        await route.fulfill({ status: 500 });
      })
      .handler("/api/telemetry/tool-summary", async (route) => {
        await route.fulfill({ status: 500 });
      })
      .handler("/api/telemetry/memory/stats", async (route) => {
        await route.fulfill({ status: 500 });
      })
      .handler("/api/telemetry/health", async (route) => {
        await route.fulfill({ status: 500 });
      });

    await router.install(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible({ timeout: 10000 });
  });
});

test.describe("New pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("onboarding_done", "1"));
  });

  test("timeline page loads and shows events", async ({ page }) => {
    const router = buildCommonMocks();
    router.json("/api/timeline/events", {
      items: [
        {
          id: "evt-1",
          seq: 1,
          type: "GoalCreated",
          description: "创建了目标「学习 Rust」",
          actor: "user",
          ts: "2026-06-28T08:00:00Z",
          payload_snippet: { title: "学习 Rust" },
        },
        {
          id: "evt-2",
          seq: 2,
          type: "MemoryDerived",
          description: "AI 记住了新信息: 用户喜欢跑步",
          actor: "system",
          ts: "2026-06-28T09:00:00Z",
          payload_snippet: { content: "用户喜欢跑步" },
        },
        {
          id: "evt-3",
          seq: 3,
          type: "BeliefFormed",
          description: "AI 生成了新认知: 用户是早起型人",
          actor: "system",
          ts: "2026-06-27T21:30:00Z",
          payload_snippet: { content: "用户是早起型人" },
        },
      ],
      total: 3,
      page: 1,
      page_size: 30,
      has_more: false,
      icons: { GoalCreated: "target", MemoryDerived: "brain", BeliefFormed: "lightbulb" },
    });
    await router.install(page);

    await page.goto("/timeline");
    await expect(page.getByText("人生时间线")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("学习 Rust")).toBeVisible();
    await expect(page.getByText("用户喜欢跑步")).toBeVisible();
    await expect(page.getByText("用户是早起型人")).toBeVisible();
  });

  test("dashboard shows data sovereignty panel", async ({ page }) => {
    const router = buildCommonMocks();
    router.json("/api/dashboard", {
      generated_at: "2026-06-28T10:00:00Z",
      data_sovereignty: {
        total_events: 1250,
        total_memories: 121,
        memories_self_report: 45,
        memories_claim: 75,
        total_goals: 8,
        goals_active: 5,
        goals_completed: 3,
        total_conversations: 42,
        total_messages: 1250,
        data_location: "本地存储 (SQLite + ChromaDB)",
        last_belief_reflection: "2026-06-27T21:30:00Z",
        export_supported: true,
      },
      active_goals: { count: 5, top: [] },
      recent_events: { count: 0, total_in_window: 0, items: [] },
      recent_memories: { count: 0, items: [] },
      timer_status: { active_timers: 0, items: [] },
      governance_status: { active_policies: 10 },
    });
    await router.install(page);

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "今天", exact: true })).toBeVisible({
      timeout: 10000,
    });
    // 数据主权面板折叠在"运行状况"中，需先展开
    await page.getByText("运行状况").click();
    await expect(page.getByRole("heading", { name: "我的数据" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("1,250")).toBeVisible(); // total_events
    await expect(page.getByText("121")).toBeVisible(); // total_memories
    await expect(page.getByText("全部本地存储")).toBeVisible();
  });
});
