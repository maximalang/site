import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  HubReadModelSchema,
  OperationsReadModelSchema,
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
    accounts: [
      {
        accountId: "account_11111111-1111-1111-1111-111111111111",
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        label: "OpenAI owner API",
        authMechanism: "API_KEY",
        availableSurfaces: ["API"],
        health: "UNCONFIGURED",
        isEnabled: true,
        createdAt: "2026-08-13T06:00:00.000Z",
      },
      {
        accountId: "account_12121212-1212-1212-1212-121212121212",
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        label: "ChatGPT Plus primary",
        authMechanism: "CHATGPT_INTERACTIVE",
        subscription: "Plus",
        availableSurfaces: ["CHAT"],
        health: "ACTIVE",
        isEnabled: true,
        createdAt: "2026-08-13T06:00:01.000Z",
      },
    ],
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
        routes: [
          {
            modelRouteId: "model_route_30303030-3030-3030-3030-303030303030",
            providerId: "provider_10101010-1010-1010-1010-101010101010",
            accountId: "account_11111111-1111-1111-1111-111111111111",
            surface: "API",
            remoteModelId: "gpt-5-mini",
            availability: "AVAILABLE",
            contextWindowTokens: 200000,
            reasoningEfforts: ["MEDIUM"],
            supportedModalities: ["TEXT"],
            supportedToolIds: [],
            isEnabled: true,
          },
        ],
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
    projects: [
      {
        projectId,
        slug: "ai-world",
        name: "AI World",
        isArchived: false,
        createdAt: "2026-08-13T06:00:00.000Z",
        agentIds: [agentId],
      },
    ],
  });
  const operationsFixture = OperationsReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt: "2026-08-13T06:00:04.000Z",
    actionGraph: { nodes: [], edges: [] },
    observatory: {
      runs: { total: 0, completed: 0, failed: 0 },
      tokens: { input: 0, cachedInput: 0, output: 0 },
      context: { estimatedTokens: 0, budgetTokens: 0, pressure: 0 },
      monetaryCost: { status: "UNAVAILABLE" },
      routeSignals: [],
    },
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
  let memoryProposalPending = true;

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
  await page.route("**/api/operations", (route) =>
    route.fulfill({ body: JSON.stringify(operationsFixture), contentType: "application/json" }),
  );
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-13T06:00:04.000Z",
        integrations: [],
      }),
      contentType: "application/json",
    }),
  );
  await page.route("**/api/schedules**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ schemaVersion: 1, schedules: [] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty("accountId");
    expect(body).toMatchObject({
      projectId,
      agentId,
      title: "Daily evidence audit",
      cronExpression: "0 9 * * *",
      isEnabled: true,
    });
    const now = "2026-08-15T12:00:00.000Z";
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        schedule: {
          outcome: "CREATED",
          schedule: {
            schemaVersion: 1,
            ...body,
            nextFireAt: "2026-08-16T06:00:00.000Z",
            createdAt: now,
            updatedAt: now,
          },
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/hub/native-chat-profiles", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ schemaVersion: 1, profiles: [] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      schemaVersion: 1,
      accountId: "account_12121212-1212-1212-1212-121212121212",
      profileRef: "plus-1",
      launchUrl: "https://chatgpt.com/g/ai-world-agent",
      isEnabled: true,
    });
    await route.fulfill({
      body: JSON.stringify({
        ...body,
        updatedAt: "2026-08-13T06:02:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/hub/provider-credentials", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    const body = route.request().postDataJSON() as {
      schemaVersion: number;
      commandId: string;
      accountId: string;
      apiKey: string;
    };
    expect(body).toEqual({
      schemaVersion: 1,
      commandId: expect.stringMatching(/^provider-key-[0-9a-f-]{36}$/),
      accountId: "account_11111111-1111-1111-1111-111111111111",
      apiKey: "browser-provider-secret",
    });
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        outcome: "CREATED",
        accountId: body.accountId,
        credentialConfigured: true,
        version: 1,
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/hub/model-routes/check", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    expect(route.request().postDataJSON()).toEqual({
      schemaVersion: 1,
      modelRouteId: "model_route_30303030-3030-3030-3030-303030303030",
    });
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        runId: "run_40404040-4040-4040-4040-404040404040",
        modelRouteId: "model_route_30303030-3030-3030-3030-303030303030",
        providerId: "provider_10101010-1010-1010-1010-101010101010",
        accountId: "account_11111111-1111-1111-1111-111111111111",
        mode: "API",
        remoteModelId: "gpt-5-mini",
        status: "SUCCEEDED",
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/hub/preferences", (route) =>
    route.fulfill({
      body: JSON.stringify(preferenceFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/memory**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      expect(request.headers()["x-agent-world-csrf"]).toBe(csrfToken);
      expect(request.postDataJSON()).toMatchObject({
        action: "ACCEPT",
        projectId,
        proposalId: "memory_proposal_56565656-5656-5656-5656-565656565656",
      });
      memoryProposalPending = false;
      await route.fulfill({
        body: JSON.stringify({ outcome: "CREATED" }),
        contentType: "application/json",
        status: 201,
      });
      return;
    }
    const view = url.searchParams.get("view");
    const body =
      view === "TIMELINE"
        ? { schemaVersion: 1, projectId, entries: [] }
        : view === "NETWORK"
          ? { schemaVersion: 1, projectId, nodes: [], edges: [] }
          : {
              schemaVersion: 1,
              projectId,
              proposals: memoryProposalPending
                ? [
                    {
                      schemaVersion: 1,
                      id: "memory_proposal_56565656-5656-5656-5656-565656565656",
                      projectId,
                      sourceContextItemId: "context_item_57575757-5757-5757-5757-575757575757",
                      content: "PostgreSQL remains canonical.",
                      contentHash: "a".repeat(64),
                      estimatedTokens: 5,
                      importance: 0.9,
                      status: "PENDING",
                      createdAt: "2026-08-13T06:03:00.000Z",
                    },
                  ]
                : [],
            };
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      status: 200,
    });
  });
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
  await expect(page.getByText("Research Lead → Reviewer", { exact: true })).toBeVisible();
  await expect(page.locator("[data-handoff-cue]")).toHaveCount(1);

  const skipLink = page.getByRole("link", { name: "К содержанию" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  expect(
    await skipLink.evaluate((element) => element.getBoundingClientRect().left),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const worldAgent = page
    .locator('[data-skin="openclaw-office-open-floor-v1"]')
    .getByRole("button", { name: new RegExp(fixtureAgent) });
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
  await expect(page.getByRole("heading", { level: 2, name: "Новая Mission" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Новый Agent" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "GPT-X" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(fixtureAgent) })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Execution preferences" }),
  ).toBeVisible();
  await expect(page.getByText("Источник: System Defaults")).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 2, name: "Интеграции" })).toBeVisible();

  const memorySection = page.locator("section.memory-center-launcher");
  await memorySection.getByRole("button", { name: "Открыть Memory Center" }).click();
  const memoryDialog = page.getByRole("dialog", { name: "Memory Center · AI World" });
  await expect(memoryDialog).toBeVisible();
  await expect(memoryDialog.getByText("PostgreSQL remains canonical.")).toBeVisible();
  await expect(memoryDialog.getByRole("button", { name: "Закрыть Memory Center" })).toBeFocused();
  await memoryDialog.getByRole("button", { name: "Accept" }).click();
  await expect(memoryDialog.getByText("Inbox пуст.")).toBeVisible();
  await memoryDialog.getByRole("tab", { name: "Inbox" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(memoryDialog.getByRole("tab", { name: "Timeline" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const memoryAccessibility = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(memoryAccessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(memoryDialog).toBeHidden();
  await expect(memorySection.getByRole("button", { name: "Открыть Memory Center" })).toBeFocused();

  const nativeChatSection = page.locator("section.native-chat-profile-panel");
  await expect(nativeChatSection.getByRole("heading", { name: "Native Plus Chat" })).toBeVisible();
  await expect(nativeChatSection.getByLabel("Browser profile alias")).toHaveCount(0);
  await nativeChatSection
    .getByLabel("AI World App URL")
    .fill("https://chatgpt.com/g/ai-world-agent");
  await nativeChatSection.getByRole("button", { name: "Сохранить подключение" }).click();
  await expect(nativeChatSection.getByText("Подключение сохранено")).toBeVisible();
  await nativeChatSection.getByRole("button", { name: "Advanced" }).click();
  await expect(nativeChatSection.getByLabel("Browser profile alias")).toHaveValue("plus-1");

  const scheduleSection = page.locator("section.schedule-panel");
  await expect(scheduleSection.getByRole("heading", { name: "Расписания" })).toBeVisible();
  await expect(scheduleSection.getByText("Расписаний пока нет.")).toBeVisible();
  await scheduleSection.getByLabel("Название задачи").fill("Daily evidence audit");
  await scheduleSection.getByRole("button", { name: "Создать расписание" }).click();
  await expect(scheduleSection.getByText("Расписание создано")).toBeVisible();
  await expect(scheduleSection.getByText(/0 9 \* \* \*/)).toBeVisible();
  await scheduleSection.getByRole("button", { name: "Advanced" }).click();
  await expect(scheduleSection.getByLabel("Cron (5 полей)")).toBeVisible();

  const providerKeySection = page
    .locator("section.hub-registry-section")
    .filter({ has: page.getByRole("heading", { name: "API provider key" }) });
  const apiKeyInput = providerKeySection.getByLabel("API key");
  await expect(apiKeyInput).toHaveAttribute("type", "password");
  await apiKeyInput.fill("browser-provider-secret");
  await providerKeySection.locator('button[type="submit"]').click();
  await expect(providerKeySection.getByRole("status")).toBeVisible();
  await expect(apiKeyInput).toHaveValue("");
  await expect(page.getByText("browser-provider-secret")).toHaveCount(0);

  const routeCheckSection = page
    .locator("section.hub-registry-section")
    .filter({ hasText: "gpt-5-mini" });
  await routeCheckSection.locator("button").click();
  const routeReceipt = routeCheckSection.getByRole("status");
  await expect(routeReceipt).toContainText("API");
  await expect(routeReceipt).toContainText("provider_10101010-1010-1010-1010-101010101010");
  await expect(routeReceipt).toContainText("account_11111111-1111-1111-1111-111111111111");
  await expect(routeReceipt).toContainText("gpt-5-mini");
  await expect(routeReceipt).toContainText("7 tokens");

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
