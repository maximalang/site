import { expect, test } from "@playwright/test";

test("production fails closed and excludes development browser capabilities", async ({
  page,
  request,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (failed) => {
    failedRequests.push(`${failed.method()} ${failed.url()}: ${failed.failure()?.errorText}`);
  });

  const pageResponse = await page.goto("/");
  await expect(page.getByRole("status", { name: "Runtime недоступен" })).toBeVisible();
  await expect(
    page.getByText("Интерфейс не создаёт вымышленных агентов или активность."),
  ).toBeVisible();

  const apiResponse = await request.get("/api/world");
  const model = (await apiResponse.json()) as { source?: unknown; agents?: unknown[] };
  const policy = pageResponse?.headers()["content-security-policy"] ?? "";

  expect(pageResponse?.ok()).toBe(true);
  expect(apiResponse.ok()).toBe(true);
  expect(model).toMatchObject({ source: "UNAVAILABLE", agents: [] });
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("upgrade-insecure-requests");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toContain("ws:");
  expect(pageResponse?.headers()["strict-transport-security"]).toContain("max-age=31536000");
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("production-unavailable.png"),
  });
});
