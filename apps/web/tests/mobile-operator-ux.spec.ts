import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { buildContractFixture } from "../src/test-fixtures";

const csrfToken = "m".repeat(43);
const agentId = "agent_11111111-1111-1111-1111-111111111111";
const conversationId = "conversation_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const projectId = "project_33333333-3333-3333-3333-333333333333";

type DecisionRequest = {
  schemaVersion: 1;
  taskId: string;
  decisionId: string;
  decision: "APPROVE" | "DENY" | "REVOKE";
  reason?: string;
};

type WorldRequestRecord = {
  sequence: number;
  method: string;
  url: string;
  observedAtMs: number;
};

function approvalId(taskId: string) {
  return `approval_${taskId.slice("task_".length)}`;
}

async function installRoutes(page: Page, decisions: DecisionRequest[]) {
  const worldRequests: WorldRequestRecord[] = [];
  const routeStartedAt = Date.now();

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        authenticated: true,
        csrfToken,
        expiresAt: "2026-08-20T20:00:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/world", (route) => {
    const request = route.request();
    worldRequests.push({
      sequence: worldRequests.length + 1,
      method: request.method(),
      url: request.url(),
      observedAtMs: Date.now() - routeStartedAt,
    });
    return route.fulfill({
      body: JSON.stringify(buildContractFixture()),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/agents/${agentId}/conversations`, (route) =>
    route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-08-20T12:00:00.000Z",
        agent: { agentId, displayName: "Research Lead" },
        conversations: [
          {
            conversationId,
            projectId,
            title: "Protocol review",
            createdAt: "2026-08-20T11:00:00.000Z",
            taskAssignmentAvailable: true,
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route("**/api/tasks", async (route) => {
    const input = route.request().postDataJSON() as {
      taskId: string;
      conversationId: string;
      agentId: string;
      title: string;
      description?: string;
    };
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        outcome: "CREATED",
        task: {
          schemaVersion: 1,
          id: input.taskId,
          projectId,
          assigneeAgentId: input.agentId,
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          approvalRequirement: "REQUIRED",
          idempotencyKey: `task:${input.taskId.slice("task_".length)}`,
          createdAt: "2026-08-20T12:01:00.000Z",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/approvals", async (route) => {
    const input = route.request().postDataJSON() as DecisionRequest;
    decisions.push(input);
    expect(route.request().headers()["x-agent-world-csrf"]).toBe(csrfToken);

    const approval =
      input.decision === "APPROVE"
        ? {
            type: "APPROVED",
            approvalId: approvalId(input.taskId),
            decidedAt: "2026-08-20T12:02:00.000Z",
          }
        : {
            type: input.decision === "DENY" ? "DENIED" : "REVOKED",
            approvalId: approvalId(input.taskId),
            decidedAt: "2026-08-20T12:03:00.000Z",
            reason: input.reason,
          };
    const run =
      input.decision === "APPROVE"
        ? {
            schemaVersion: 1,
            id: `run_${input.taskId.slice("task_".length)}`,
            taskId: input.taskId,
            agentId,
            approvalId: approvalId(input.taskId),
            adapterKind: "OPENCLAW",
            bindingId: "binding_66666666-6666-6666-6666-666666666666",
            sessionId: "session_77777777-7777-7777-7777-777777777777",
            status: "DISPATCH_PENDING",
            attempt: 0,
            dispatchIdempotencyKey: `run:${input.taskId.slice("task_".length)}`,
            createdAt: "2026-08-20T12:02:00.000Z",
          }
        : undefined;

    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        outcome: "DECIDED",
        approval,
        ...(run ? { run } : {}),
        dispatch: input.decision === "APPROVE" ? "PENDING" : "NOT_APPLICABLE",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  return { worldRequests: () => [...worldRequests] };
}

async function assignTask(page: Page, title: string) {
  const dialog = page.getByRole("dialog", { name: "Задача для Research Lead" });
  await dialog.getByLabel("Название").fill(title);
  await dialog.getByLabel("Описание").fill("Сохранить ссылки на источники.");
  await dialog.getByRole("button", { name: "Назначить задачу" }).click();
  await expect(dialog.getByRole("heading", { name: "Задача назначена" })).toBeVisible();
  await expect(dialog.getByText("Protocol review", { exact: true })).toBeVisible();
  await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  await expect(dialog.getByText("Сохранить ссылки на источники.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Название")).toHaveCount(0);
  await expect(dialog.getByLabel("Описание")).toHaveCount(0);
  return dialog;
}

test("Command and Task expose compact mobile operator decisions without changing desktop inspector", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const unexpectedOrigins: string[] = [];
  const decisions: DecisionRequest[] = [];
  const routes = await installRoutes(page, decisions);

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") unexpectedOrigins.push(url.origin);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "AI World" })).toBeVisible();

  // Next App Router development runs mount Effects through React Strict Mode's
  // setup → cleanup → setup cycle. Capture that initial baseline instead of a
  // magic request count, then require navigation/selection to add no refetches.
  const initialWorldRequests = routes.worldRequests();
  expect(initialWorldRequests.length).toBeGreaterThanOrEqual(1);
  for (const request of initialWorldRequests) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/world");
    expect(request.sequence).toBeGreaterThanOrEqual(1);
    expect(request.observedAtMs).toBeGreaterThanOrEqual(0);
  }
  const initialWorldRequestCount = initialWorldRequests.length;

  await page.getByRole("tab", { name: "Command" }).click();
  const researchRow = page.getByRole("row", { name: /Research Lead/ });
  const reviewerRow = page.getByRole("row", { name: /Reviewer/ });
  await researchRow.getByRole("button", { name: "Выбрать Research Lead" }).click();
  await expect(researchRow).toHaveAttribute("data-selected", "true");
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount);

  const viewportWidth = page.viewportSize()?.width ?? 1440;
  const inspector = page.getByRole("region", { name: "Research Lead" });
  if (viewportWidth <= 640) {
    await expect(inspector).toBeHidden();
    await expect(
      researchRow.getByText("Подтверждение: Не требуется", { exact: true }),
    ).toBeVisible();
  } else {
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText("Не требуется", { exact: true })).toBeVisible();
  }
  await expect(researchRow.getByRole("button", { name: "Диалог" })).toBeVisible();
  await expect(researchRow.getByRole("button", { name: "Задача" })).toBeVisible();

  await reviewerRow.getByRole("button", { name: "Выбрать Reviewer" }).click();
  await expect(reviewerRow).toHaveAttribute("data-selected", "true");
  await expect(researchRow).toHaveAttribute("data-selected", "false");
  if (viewportWidth <= 640) {
    await expect(reviewerRow.getByText("Подтверждение: Требуется", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("region", { name: "Reviewer" })).toBeVisible();
  }
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const commandAccessibility = await new AxeBuilder({ page }).analyze();
  expect(commandAccessibility.violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: testInfo.outputPath(`${testInfo.project.name}-phase2-command.png`),
  });

  await researchRow.getByRole("button", { name: "Задача" }).click();
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount);
  let taskDialog = await assignTask(page, "Проверить новый контракт");
  await expect.poll(() => routes.worldRequests().length).toBe(initialWorldRequestCount + 1);
  const approve = taskDialog.getByRole("button", { name: "Подтвердить и запустить" });
  const reject = taskDialog.getByRole("button", { name: "Отклонить" });
  await expect(approve).toBeVisible();
  await expect(reject).toBeVisible();
  await expect(taskDialog.getByLabel("Причина отклонения")).toHaveCount(0);
  if (viewportWidth === 320) await expect(approve).toBeInViewport();

  await reject.click();
  expect(decisions).toHaveLength(0);
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount + 1);
  const rejectionReason = taskDialog.getByLabel("Причина отклонения");
  await expect(rejectionReason).toBeVisible();
  await expect(rejectionReason).toBeFocused();
  const denyConfirm = taskDialog.getByRole("button", { name: "Подтвердить отклонение" });
  await expect(denyConfirm).toBeDisabled();
  await rejectionReason.fill("  Duplicate request  ");
  await expect(denyConfirm).toBeEnabled();
  await taskDialog.getByRole("button", { name: "Отмена" }).click();
  await expect(taskDialog.getByLabel("Причина отклонения")).toHaveCount(0);
  await expect(reject).toBeFocused();
  expect(decisions).toHaveLength(0);
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount + 1);

  await reject.click();
  await taskDialog.getByLabel("Причина отклонения").fill("  Duplicate request  ");
  await taskDialog.getByRole("button", { name: "Подтвердить отклонение" }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toMatchObject({ decision: "DENY", reason: "Duplicate request" });
  await expect.poll(() => routes.worldRequests().length).toBe(initialWorldRequestCount + 2);
  await expect(taskDialog.getByText("Выполнение задачи отклонено.", { exact: true })).toBeVisible();

  await taskDialog.getByRole("button", { name: "Закрыть назначение задачи" }).click();
  await researchRow.getByRole("button", { name: "Задача" }).click();
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount + 2);
  taskDialog = await assignTask(page, "Повторно проверить контракт");
  await expect.poll(() => routes.worldRequests().length).toBe(initialWorldRequestCount + 3);
  await taskDialog.getByRole("button", { name: "Подтвердить и запустить" }).click();
  await expect.poll(() => decisions.length).toBe(2);
  expect(decisions[1]).toMatchObject({ decision: "APPROVE" });
  await expect.poll(() => routes.worldRequests().length).toBe(initialWorldRequestCount + 4);
  await expect(taskDialog.getByLabel("Причина отзыва")).toHaveCount(0);

  const revoke = taskDialog.getByRole("button", { name: "Отозвать разрешение" });
  await revoke.click();
  expect(decisions).toHaveLength(2);
  expect(routes.worldRequests()).toHaveLength(initialWorldRequestCount + 4);
  const revokeReason = taskDialog.getByLabel("Причина отзыва");
  await expect(revokeReason).toBeVisible();
  await expect(revokeReason).toBeFocused();
  const revokeConfirm = taskDialog.getByRole("button", { name: "Подтвердить отзыв" });
  await expect(revokeConfirm).toBeDisabled();
  await revokeReason.fill("  Changed priorities  ");
  await revokeConfirm.click();
  await expect.poll(() => decisions.length).toBe(3);
  expect(decisions[2]).toMatchObject({ decision: "REVOKE", reason: "Changed priorities" });
  await expect.poll(() => routes.worldRequests().length).toBe(initialWorldRequestCount + 5);

  const taskAccessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(taskAccessibility.violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: testInfo.outputPath(`${testInfo.project.name}-phase2-task.png`),
  });

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(unexpectedOrigins).toEqual([]);
});
