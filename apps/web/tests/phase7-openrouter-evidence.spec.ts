import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  HubReadModelSchema,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import { expect, type Page, test } from "@playwright/test";
import { buildContractFixture } from "../src/test-fixtures";

const providerId = "provider_70707070-7070-7070-7070-707070707070";
const accountId = "account_71717171-7171-7171-7171-717171717171";
const canonicalModelId = "model_72727272-7272-7272-7272-727272727272";
const modelRouteId = "model_route_73737373-7373-7373-7373-737373737373";
const runId = "run_74747474-7474-7474-7474-747474747474";
const projectId = "project_33333333-3333-3333-3333-333333333333";
const remoteModelId = "anthropic/claude-sonnet-4.5";
const csrfToken = "o".repeat(43);

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport);
}

test("Phase 7 OpenRouter Hub evidence", async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === "desktop-chromium";
  const mobile = testInfo.project.name === "mobile-chromium";
  test.skip(!desktop && !mobile, "Phase 7 evidence is required only at 1440 and 390 widths");

  const world = buildContractFixture();
  const agent = world.agents[0];
  if (!agent) throw new Error("Contract fixture requires one agent");

  const hub = HubReadModelSchema.parse({
    schemaVersion: 1,
    generatedAt: "2026-08-23T21:30:00.000Z",
    providers: [
      {
        providerId,
        slug: "openrouter",
        displayName: "OpenRouter",
        kind: "OPENROUTER",
        category: "LLM_API",
        isEnabled: true,
      },
    ],
    accounts: [
      {
        accountId,
        providerId,
        label: "OpenRouter owner API",
        authMechanism: "API_KEY",
        availableSurfaces: ["API"],
        health: "ACTIVE",
        isEnabled: true,
        createdAt: "2026-08-23T21:25:00.000Z",
      },
    ],
    models: [
      {
        modelId: canonicalModelId,
        slug: "claude-sonnet",
        displayName: "Claude Sonnet",
        family: "claude",
        capabilities: {
          reasoning: true,
          toolUse: true,
          modalities: ["TEXT"],
          contextWindowTokens: 200000,
        },
        isEnabled: true,
        routes: [
          {
            modelRouteId,
            providerId,
            accountId,
            surface: "API",
            remoteModelId,
            availability: "AVAILABLE",
            contextWindowTokens: 200000,
            reasoningEfforts: ["LOW", "MEDIUM", "HIGH"],
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
        agentId: agent.agentId,
        slug: "researcher",
        displayName: agent.displayName,
        role: agent.role,
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
        createdAt: "2026-08-23T21:20:00.000Z",
        agentIds: [agent.agentId],
      },
    ],
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
  const preferences = ExecutionPreferenceReadModelSchema.parse({
    schemaVersion: 1,
    selection: {},
    local: systemPreferences,
    resolved: resolveExecutionPreferences([systemPreferences]),
  });

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        authenticated: true,
        csrfToken,
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/world", (route) =>
    route.fulfill({ body: JSON.stringify(world), contentType: "application/json", status: 200 }),
  );
  await page.route("**/api/hub", (route) =>
    route.fulfill({ body: JSON.stringify(hub), contentType: "application/json", status: 200 }),
  );
  await page.route("**/api/hub/preferences", (route) =>
    route.fulfill({
      body: JSON.stringify(preferences),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/hub/model-routes/check", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    expect(route.request().postDataJSON()).toEqual({ schemaVersion: 1, modelRouteId });
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        runId,
        modelRouteId,
        providerId,
        accountId,
        mode: "API",
        remoteModelId,
        status: "SUCCEEDED",
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Hub" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Canonical Hub" })).toBeVisible();
  await expect(page.getByText("OpenRouter", { exact: true }).first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: testInfo.outputPath(
      desktop
        ? "phase7-1440-hub-registry-openrouter.png"
        : "phase7-390-hub-registry-openrouter.png",
    ),
  });

  if (desktop) {
    await page.getByRole("tab", { name: "Настройка" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "OpenRouter" })).toBeVisible();
    await expect(page.getByLabel("OpenRouter model ID")).toBeVisible();
    await expect(page.getByText("https://openrouter.ai/api/v1", { exact: false })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      path: testInfo.outputPath("phase7-1440-openrouter-account-setup.png"),
    });
  }

  await page.getByRole("tab", { name: "Маршруты" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "API-ключ провайдера" })).toBeVisible();
  await expect(page.getByLabel("АккаунтOpenRouter owner API", { exact: true })).toHaveValue(accountId);
  const secretField = page.getByLabel("API-ключ", { exact: true });
  await expect(secretField).toHaveAttribute("type", "password");
  await expect(secretField).toHaveValue("");
  await expect(page.getByText(remoteModelId, { exact: false }).first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: testInfo.outputPath(
      desktop ? "phase7-1440-hub-routing-openrouter.png" : "phase7-390-hub-routing-openrouter.png",
    ),
  });

  if (desktop) {
    const routeRow = page.getByRole("listitem").filter({ hasText: remoteModelId });
    await routeRow.getByRole("button", { name: "Проверить" }).click();
    const receipt = page.getByRole("status");
    await expect(receipt).toContainText(remoteModelId);
    await expect(receipt).toContainText("токенов: 7");
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      path: testInfo.outputPath("phase7-1440-route-check-result.png"),
    });
  }
});
