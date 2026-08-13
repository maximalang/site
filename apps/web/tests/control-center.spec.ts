import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const fixtureAgent = "Research Lead";
const fixtureTask = "Verify protocol contract";

test("World and Command expose one canonical agent projection", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const unexpectedOrigins: string[] = [];
  const apiCursors: number[] = [];

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

  await commandTab.focus();
  await page.keyboard.press("Home");
  const worldTab = page.getByRole("tab", { name: "World" });
  await expect(worldTab).toBeFocused();
  await expect(worldTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(commandTab).toBeFocused();
  await expect(commandTab).toHaveAttribute("aria-selected", "true");

  const commandAccessibility = await new AxeBuilder({ page }).analyze();
  expect(commandAccessibility.violations).toEqual([]);

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
    path: testInfo.outputPath(`${testInfo.project.name}-command.png`),
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
