import { expect, test } from "@playwright/test";

test("production without secrets fails closed at the owner gate", async ({
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Контур входа недоступен" }),
  ).toBeVisible();

  const apiResponse = await request.get("/api/world");
  const model = (await apiResponse.json()) as { error?: { code?: unknown } };
  const policy = pageResponse?.headers()["content-security-policy"] ?? "";

  expect(pageResponse?.ok()).toBe(true);
  expect(apiResponse.status()).toBe(401);
  expect(model).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("upgrade-insecure-requests");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toContain("ws:");
  expect(pageResponse?.headers()["strict-transport-security"]).toContain("max-age=31536000");
  expect(consoleErrors).toEqual([
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
  ]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);

  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("production-auth-unavailable.png"),
  });
});
