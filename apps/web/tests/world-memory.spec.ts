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

const projectId = "project_33333333-3333-3333-3333-333333333333";
const csrfToken = "c".repeat(43);

const hubFixture = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-17T12:00:00.000Z",
  providers: [],
  accounts: [],
  models: [],
  executionRoutes: [],
  agents: [],
  skills: [],
  tools: [],
  projects: [
    {
      projectId,
      slug: "ai-world",
      name: "AI World",
      isArchived: false,
      createdAt: "2026-08-17T12:00:00.000Z",
      agentIds: [],
    },
  ],
});

const operationsFixture = OperationsReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-17T12:00:00.000Z",
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

async function installReadRoutes(page: import("@playwright/test").Page) {
  const worldFixture = buildContractFixture();
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        authenticated: true,
        csrfToken,
        expiresAt: "2026-08-17T18:00:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/world", (route) =>
    route.fulfill({
      body: JSON.stringify(worldFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/hub", (route) =>
    route.fulfill({
      body: JSON.stringify(hubFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/operations", (route) =>
    route.fulfill({
      body: JSON.stringify(operationsFixture),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-17T12:00:00.000Z",
        integrations: [],
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/hub/native-chat-profiles", (route) =>
    route.fulfill({
      body: JSON.stringify({ schemaVersion: 1, profiles: [] }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/schedules**", (route) =>
    route.fulfill({
      body: JSON.stringify({ schemaVersion: 1, schedules: [] }),
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
  await page.route("**/api/memory**", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view");
    const body =
      view === "NETWORK"
        ? {
            schemaVersion: 1,
            projectId,
            nodes: [
              {
                contextItemId: "context_item_58585858-5858-5858-5858-585858585858",
                sourceContextItemId: "context_item_57575757-5757-5757-5757-575757575757",
                content: "PostgreSQL remains canonical.",
                importance: 0.9,
                createdAt: "2026-08-17T12:00:00.000Z",
              },
              {
                contextItemId: "context_item_59595959-5959-5959-5959-595959595959",
                sourceContextItemId: "context_item_58585858-5858-5858-5858-585858585858",
                content: "Memory provenance is canonical.",
                importance: 0.8,
                createdAt: "2026-08-17T12:01:00.000Z",
              },
            ],
            edges: [
              {
                decisionId: "memory_decision_60606060-6060-6060-6060-606060606060",
                sourceContextItemId: "context_item_57575757-5757-5757-5757-575757575757",
                targetContextItemId: "context_item_58585858-5858-5858-5858-585858585858",
                relation: "ACCEPTED_FROM",
                createdAt: "2026-08-17T12:00:00.000Z",
              },
              {
                decisionId: "memory_decision_61616161-6161-6161-6161-616161616161",
                sourceContextItemId: "context_item_58585858-5858-5858-5858-585858585858",
                targetContextItemId: "context_item_59595959-5959-5959-5959-595959595959",
                relation: "MERGED_INTO",
                createdAt: "2026-08-17T12:01:00.000Z",
              },
            ],
          }
        : view === "TIMELINE"
          ? { schemaVersion: 1, projectId, entries: [] }
          : { schemaVersion: 1, projectId, proposals: [] };
    return route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      status: 200,
    });
  });
}

test("World skin preference and Memory Network remain canonical in the browser", async ({
  page,
}, testInfo) => {
  await installReadRoutes(page);
  await page.goto("/");

  const skinSelector = page.getByLabel("Вид карты");
  await expect(skinSelector).toHaveValue("openclaw-office-open-floor-v1");
  await expect(page.getByRole("button", { name: "Сбросить" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Research Lead.*Открыть карточку агента/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);

  await skinSelector.selectOption("space-station-v1");
  const spaceStation = page.locator('[data-skin="space-station-v1"]');
  await expect(spaceStation).toBeVisible();
  await expect(spaceStation.getByRole("button", { name: /Research Lead/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сбросить" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("agent-world.office-skin.v1"))).toBe(
    "space-station-v1",
  );
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: testInfo.outputPath(`${testInfo.project.name}-world-space-station.png`),
  });

  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page.locator('[data-skin="openclaw-office-open-floor-v1"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Сбросить" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("agent-world.office-skin.v1"))).toBeNull();

  await page.getByRole("tab", { name: "Hub" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Canonical Hub" })).toBeVisible();
  await page.getByRole("tab", { name: "Memory" }).click();
  const memorySection = page.locator("section.memory-center-launcher");
  await memorySection.getByRole("button", { name: "Открыть Memory Center" }).click();
  const memoryDialog = page.getByRole("dialog", { name: "Memory Center · AI World" });
  await memoryDialog.getByRole("tab", { name: "Network" }).click();

  const graph = memoryDialog.getByTestId("memory-network-graph");
  await expect(graph).toBeVisible();
  await expect(memoryDialog.locator("[data-relation='ACCEPTED_FROM']")).toHaveCount(1);
  await expect(memoryDialog.locator("[data-relation='MERGED_INTO']")).toHaveCount(1);
  await expect(memoryDialog.locator("[data-memory-kind='memory']")).toHaveCount(2);
  await expect(memoryDialog.locator("[data-memory-kind='reference']")).toHaveCount(1);
  await expect(memoryDialog.getByText("Canonical memory", { exact: true })).toBeVisible();
  await expect(memoryDialog.getByText("Provenance context", { exact: true })).toBeVisible();
  await expect(memoryDialog.getByText("Accepted from", { exact: true })).toBeVisible();
  await expect(memoryDialog.getByText("Merged into", { exact: true })).toBeVisible();
  expect(Number(await graph.getAttribute("height"))).toBeLessThanOrEqual(360);

  const graphRegion = memoryDialog.getByRole("region", {
    name: "Прокручиваемая схема Memory Network",
  });
  await expect(graphRegion).toHaveAttribute("tabindex", "0");
  await graphRegion.focus();
  await expect(graphRegion).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);

  const accessibility = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(accessibility.violations).toEqual([]);
  await memoryDialog.screenshot({
    animations: "disabled",
    caret: "hide",
    path: testInfo.outputPath(`${testInfo.project.name}-memory-network.png`),
  });
});
