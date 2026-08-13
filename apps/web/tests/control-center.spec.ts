import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  HubReadModelSchema,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { buildContractFixture } from "../src/test-fixtures";

const fixtureAgent = "Research Lead";
const fixtureTask = "Verify protocol contract";

test("World, Command and Hub expose one canonical control surface", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const unexpectedOrigins: string[] = [];
  const apiCursors: number[] = [];
  const fixture = buildContractFixture();
  const fixtureAgentRecord = fixture.agents.find((agent) => agent.displayName === fixtureAgent);
  if (!fixtureAgentRecord) throw new Error("Contract fixture is missing the Research Lead");
  const agentId = fixtureAgentRecord.agentId;
  const conversationId = "conversation_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const projectId = "project_33333333-3333-3333-3333-333333333333";
  const csrfToken = "a".repeat(43);
  const hubFixture = HubReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt: "2026-08-13T06:00:04.000Z",
    providers: [
      {
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        slug: "openai",
        displayName: "OpenAI",
        kind: "OPENAI",
        category: "LLM_API",
        isEnabled: true,
      },
    ],
    accounts: [],
    models: [
      {
        modelId: "model_20202020-2020-2020-2020-202020202020",
        slug: "gpt-x",
        displayName: "GPT-X",
        family: "gpt",
        capabilities: {
          reasoning: true,
          toolUse: true,
          modalities: ["TEXT"],
          contextWindowTokens: 200000,
        },
        isEnabled: true,
        routes: [],
      },
    ],
    executionRoutes: [],
    agents: [
      {
        agentId,
        slug: "researcher",
        displayName: fixtureAgent,
        role: fixtureAgentRecord.role,
        isEnabled: true,
        skillAssignments: [],
        toolAssignments: [],
      },
    ],
    skills: [],
    tools: [],
    projects: [],
  });
  const systemPreferences = ExecutionPreferenceLayerSchema.parse({
    schemaVersion: 1,
    scope: { kind: "SYSTEM" },
    overrides: {
      model: { kind: "AUTO" },
      account: { kind: "AUTO" },
      mode: "AUTO",
      context: "BALANCED",
      budget: "BALANCED",
    },
  });
  const preferenceFixture = ExecutionPreferenceReadModelSchema.parse({
    schemaVersion: 1,
    selection: {},
    local: systemPreferences,
    resolved: resolveExecutionPreferences([systemPreferences]),
  });
  let assignedTaskId: string | undefined;

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        authenticated: true,
        csrfToken,
        expiresAt: "2026-08-13T18:00:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/world", (route) =>
    route.fulfill({ body: JSON.stringify(fixture), contentType: "application/json", status: 200 }),
  );
  await page.route("**/api/hub", (route) =>
    route.fulfill({
      body: JSON.stringify(hubFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/hub/preferences", (route) =>
    route.fulfill({
      body: JSON.stringify(preferenceFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route(`**/api/agents/${agentId}/conversations`, (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-13T06:01:00.000Z",
        agent: { agentId, displayName: fixtureAgent },
        conversations: [
          {
            conversationId,
            projectId,
            title: "Protocol review",
            createdAt: "2026-08-13T06:00:00.000Z",
            taskAssignmentAvailable: true,
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { messageId: string; content: string };
      expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
      await route.fulfill({
        body: JSON.stringify({
          schemaVersion: 1,
          outcome: "DISPATCHED",
          message: {
            messageId: body.messageId,
            author: "OWNER",
            content: body.content,
            delivery: "DISPATCHED",
            createdAt: "2026-08-13T06:02:00.000Z",
            provenance: { kind: "DOMAIN" },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-13T06:01:00.000Z",
        conversation: {
          conversationId,
          projectId,
          title: "Protocol review",
          createdAt: "2026-08-13T06:00:00.000Z",
        },
        agent: {
          agentId,
          displayName: fixtureAgent,
          role: "Evidence-first research",
          isEnabled: true,
        },
        messages: [],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/tasks", async (route) => {
    const assignment = route.request().postDataJSON() as {
      schemaVersion: number;
      taskId: string;
      conversationId: string;
      agentId: string;
      title: string;
      description?: string;
    };
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    expect(assignment).toEqual({
      schemaVersion: 1,
      taskId: expect.stringMatching(/^task_[0-9a-f-]{36}$/),
      conversationId,
      agentId,
      title: "Проверить новый контракт",
      description: "Сохранить ссылки на источники.",
    });
    assignedTaskId = assignment.taskId;
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        outcome: "CREATED",
        task: {
          schemaVersion: 1,
          id: assignment.taskId,
          projectId,
          assigneeAgentId: agentId,
          title: assignment.title,
          description: assignment.description,
          approvalRequirement: "REQUIRED",
          idempotencyKey: `task:${assignment.taskId.slice("task_".length)}`,
          createdAt: "2026-08-13T06:03:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") {
      unexpectedOrigins.push(url.origin);
    }
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname === "/api/world" && response.ok()) {
      const body = (await response.json()) as { cursor?: { lastSequence?: unknown } };
      if (typeof body.cursor?.lastSequence === "number") {
        apiCursors.push(body.cursor.lastSequence);
      }
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "AI World" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("проверочные данные, не live runtime");
  await expect(page.locator("main")).toHaveCount(1);

  const skipLink = page.getByRole("link", { name: "К содержанию" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  expect(
    await skipLink.evaluate((element) => element.getBoundingClientRect().left),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const worldAgent = page.getByRole("button", { name: new RegExp(fixtureAgent) });
  await worldAgent.click();
  const inspector = page.getByRole("region", { name: fixtureAgent });
  await expect(inspector.getByRole("heading", { level: 2, name: fixtureAgent })).toBeVisible();
  await expect(inspector.getByText(fixtureTask, { exact: true })).toBeVisible();
  await expect(inspector.getByText("Выполняет", { exact: true })).toHaveCount(2);
  const skipLinkRightEdge = await skipLink.evaluate(
    (element) => element.getBoundingClientRect().right,
  );
  expect(skipLinkRightEdge).toBeLessThanOrEqual(0);

  await worldAgent.dblclick();
  const conversationDialog = page.getByRole("dialog", { name: fixtureAgent });
  await expect(conversationDialog).toBeVisible();
  await expect(
    conversationDialog.getByText("Сообщений пока нет. Начните рабочий диалог."),
  ).toBeVisible();
  await conversationDialog.getByLabel("Сообщение").fill("Проверь протокол");
  await conversationDialog.getByRole("button", { name: "Отправить" }).click();
  await expect(conversationDialog.getByText("Проверь протокол")).toBeVisible();
  await expect(conversationDialog.locator('.message[data-author="AGENT"]')).toHaveCount(0);
  await conversationDialog.getByRole("button", { name: "Закрыть диалог" }).click();
  await expect(worldAgent).toBeFocused();

  await inspector.getByRole("button", { name: "Назначить задачу" }).click();
  const taskDialog = page.getByRole("dialog", { name: `Задача для ${fixtureAgent}` });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog.getByRole("button", { name: "Закрыть назначение задачи" })).toBeFocused();
  await taskDialog.getByLabel("Название").fill("Проверить новый контракт");
  await taskDialog.getByLabel("Описание").fill("Сохранить ссылки на источники.");
  await taskDialog.getByRole("button", { name: "Назначить задачу" }).click();
  await expect(taskDialog.getByText(/требует подтверждения/i)).toBeVisible();
  expect(assignedTaskId).toMatch(/^task_[0-9a-f-]{36}$/);
  const taskAccessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(taskAccessibility.violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: testInfo.outputPath(`${testInfo.project.name}-task.png`),
  });
  await taskDialog.getByRole("button", { name: "Закрыть назначение задачи" }).click();
  await expect(inspector.getByRole("button", { name: "Назначить задачу" })).toBeFocused();

  const worldAccessibility = await new AxeBuilder({ page }).analyze();
  expect(worldAccessibility.violations).toEqual([]);

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath(`${testInfo.project.name}-world.png`),
  });

  const commandTab = page.getByRole("tab", { name: "Command" });
  await commandTab.click();
  await expect(page.getByRole("heading", { level: 1, name: "Command" })).toBeVisible();
  const canonicalRow = page.getByRole("row", { name: new RegExp(fixtureAgent) });
  await expect(canonicalRow).toContainText(fixtureTask);
  await expect(canonicalRow).toContainText("Выполняет");
  await expect(inspector.getByRole("heading", { level: 2, name: fixtureAgent })).toBeVisible();

  const commandAccessibility = await new AxeBuilder({ page }).analyze();
  expect(commandAccessibility.violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath(`${testInfo.project.name}-command.png`),
  });

  await commandTab.focus();
  await page.keyboard.press("Home");
  const worldTab = page.getByRole("tab", { name: "World" });
  await expect(worldTab).toBeFocused();
  await expect(worldTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  const hubTab = page.getByRole("tab", { name: "Hub" });
  await expect(hubTab).toBeFocused();
  await expect(hubTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Canonical Hub" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "GPT-X" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(fixtureAgent) })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Execution preferences" }),
  ).toBeVisible();
  await expect(page.getByText("Источник: System Defaults")).toHaveCount(5);

  const hubAccessibility = await new AxeBuilder({ page }).analyze();
  expect(hubAccessibility.violations).toEqual([]);

  const viewport = page.viewportSize();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewport?.width ?? documentWidth);
  expect(apiCursors.length).toBeGreaterThan(0);
  expect(new Set(apiCursors)).toEqual(new Set([3]));
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(unexpectedOrigins).toEqual([]);

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath(`${testInfo.project.name}-hub.png`),
  });
});

test("the public surface sends defensive response headers", async ({ request }) => {
  const response = await request.get("/");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(response.headers()["permissions-policy"]).toBe("camera=(), geolocation=(), microphone=()");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["strict-transport-security"]).toContain("max-age=31536000");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});

test("the owner login gate does not persist credentials in browser storage", async ({ page }) => {
  const fixture = buildContractFixture();
  const csrfToken = "b".repeat(43);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      body: JSON.stringify({ error: { code: "AUTHENTICATION_REQUIRED" } }),
      contentType: "application/json",
      status: 401,
    }),
  );
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      schemaVersion: 1,
      password: "browser-only-secret",
    });
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        authenticated: true,
        csrfToken,
        expiresAt: "2026-08-13T18:00:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/world", (route) =>
    route.fulfill({ body: JSON.stringify(fixture), contentType: "application/json", status: 200 }),
  );

  await page.goto("/");
  await page.getByLabel("Пароль владельца").fill("browser-only-secret");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI World" })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: Object.values(localStorage),
      session: Object.values(sessionStorage),
      visiblePassword: document.body.textContent?.includes("browser-only-secret"),
    })),
  ).toEqual({ local: [], session: [], visiblePassword: false });
});
