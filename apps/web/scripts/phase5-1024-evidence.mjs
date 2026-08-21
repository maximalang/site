import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const viewport = { width: 1024, height: 768 };
const baseUrl = process.env.AGENT_WORLD_EVIDENCE_BASE_URL ?? "http://127.0.0.1:3210";
const outputDir =
  process.env.AGENT_WORLD_1024_OUTPUT_DIR ??
  join(process.cwd(), "apps/web/test-results/phase5-1024-evidence");
const chromeChannel =
  process.env.AGENT_WORLD_PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined;
const diagnosticLabel = process.env.AGENT_WORLD_1024_DIAGNOSTIC_LABEL ?? "current";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNear(actual, expected, label, tolerance = 0.5) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, received ${actual}`,
  );
}

async function settleAtTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  const scrollY = await page.evaluate(() => window.scrollY);
  assert(scrollY === 0, `Expected scrollY=0 after reset, received ${scrollY}`);
  return scrollY;
}

async function capture(page, name) {
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: join(outputDir, name),
  });
}

async function assertViewport(page) {
  const actual = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  assert(
    actual.width === viewport.width && actual.height === viewport.height,
    `Expected viewport ${viewport.width}x${viewport.height}, received ${actual.width}x${actual.height}`,
  );
}

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert(
    metrics.documentWidth <= metrics.viewportWidth && metrics.bodyWidth <= metrics.viewportWidth,
    `Horizontal overflow detected: viewport=${metrics.viewportWidth}, document=${metrics.documentWidth}, body=${metrics.bodyWidth}`,
  );
}

async function visibleBox(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no visible bounding box`);
  return box;
}

function assertIntersectsViewport(box, label) {
  const visible =
    box.x < viewport.width &&
    box.x + box.width > 0 &&
    box.y < viewport.height &&
    box.y + box.height > 0;
  assert(visible, `${label} is outside the viewport: ${JSON.stringify(box)}`);
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch(chromeChannel ? { channel: chromeChannel } : {});
const context = await browser.newContext({ viewport });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "World" }).waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });

  await assertViewport(page);
  await settleAtTop(page);
  await assertNoHorizontalOverflow(page);

  const worldPanel = page.locator("#world-panel");
  await visibleBox(worldPanel, "World panel");
  await capture(page, "phase5-1024x768-world-default-top.png");

  const researchAgent = page
    .locator(".openclaw-office-world")
    .getByRole("button", { name: /^Research Lead:/ });
  await researchAgent.click();

  const researchInspector = page.getByRole("region", { name: "Research Lead" });
  await researchInspector.waitFor({ state: "visible" });
  const selectedScrollY = await settleAtTop(page);
  await assertNoHorizontalOverflow(page);

  const worldBox = await visibleBox(worldPanel, "World panel");
  const inspectorBox = await visibleBox(page.locator("#world-panel + .inspector"), "Inspector");
  assertIntersectsViewport(inspectorBox, "Inspector");
  assertNear(worldBox.width, 704, "World panel width");
  assertNear(inspectorBox.width, 272, "Inspector width");
  assertNear(worldBox.width + inspectorBox.width + 16, 992, "World workspace columns");

  await capture(page, "phase5-1024x768-world-selected-research-top.png");

  const taskButton = researchInspector.getByRole("button", { name: "Назначить задачу" });
  const beforeTaskScrollY = await page.evaluate(() => window.scrollY);
  assert(
    beforeTaskScrollY === 0,
    `Expected scrollY=0 before opening task drawer, received ${beforeTaskScrollY}`,
  );
  await taskButton.click();

  const taskDialog = page.getByRole("dialog", { name: "Задача для Research Lead" });
  await taskDialog.waitFor({ state: "visible" });
  const afterTaskOpenScrollY = await page.evaluate(() => window.scrollY);
  const taskResetScrollY = await settleAtTop(page);
  await assertNoHorizontalOverflow(page);

  const backdropBox = await visibleBox(page.locator(".drawer-backdrop"), "Task drawer backdrop");
  const drawerBox = await visibleBox(taskDialog, "Task drawer");
  assertNear(backdropBox.x, 0, "Backdrop x");
  assertNear(backdropBox.y, 0, "Backdrop y");
  assertNear(backdropBox.width, viewport.width, "Backdrop width");
  assertNear(backdropBox.height, viewport.height, "Backdrop height");
  assertNear(drawerBox.x, 352, "Task drawer x");
  assertNear(drawerBox.y, 0, "Task drawer y");
  assertNear(drawerBox.width, 672, "Task drawer width");
  assertNear(drawerBox.height, viewport.height, "Task drawer height");
  assertNear(drawerBox.x + drawerBox.width, viewport.width, "Task drawer right edge");

  await capture(page, "phase5-1024x768-task-drawer.png");

  console.log(
    `PHASE5_1024_SUMMARY ${JSON.stringify({
      label: diagnosticLabel,
      viewport,
      scrollY: {
        selected: selectedScrollY,
        beforeTask: beforeTaskScrollY,
        afterTaskOpen: afterTaskOpenScrollY,
        afterTaskReset: taskResetScrollY,
      },
      world: worldBox,
      inspector: inspectorBox,
      drawer: drawerBox,
    })}`,
  );
} finally {
  await context.close();
  await browser.close();
}

console.log(`Phase 5 deterministic 1024 evidence written to ${outputDir}`);
