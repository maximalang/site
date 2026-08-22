import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.AGENT_WORLD_EVIDENCE_BASE_URL ?? "http://127.0.0.1:3210";
const outputDir = join(process.cwd(), "apps/web/test-results/phase6-ai-town-visual-evidence");
const channel = process.env.AGENT_WORLD_PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined;
const targets = [
  {
    label: "1440x1000",
    viewport: { width: 1440, height: 1000 },
    states: ["default", "research", "reviewer", "handoff", "activity"],
  },
  { label: "1024x768", viewport: { width: 1024, height: 768 }, states: ["default", "research"] },
  {
    label: "390x844",
    viewport: { width: 390, height: 844 },
    states: ["default", "research", "handoff"],
  },
  { label: "320x720", viewport: { width: 320, height: 720 }, states: ["default", "research"] },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function capture(page, target, name) {
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: join(outputDir, `phase6-${target.label}-${name}.png`),
  });
}
async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    metrics.document <= metrics.viewport && metrics.body <= metrics.viewport,
    `${label}: horizontal overflow ${JSON.stringify(metrics)}`,
  );
}
async function assertWorldDominant(page, target) {
  const renderer = page.locator('[data-renderer="agent-world-canvas-v1"]');
  const canvas = page.getByTestId("agent-world-canvas");
  await renderer.waitFor({ state: "visible" });
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  assert(box, `${target.label}: canvas has no geometry`);
  const mobile = target.viewport.width <= 720;
  assert(
    box.width >= target.viewport.width * (mobile ? 0.92 : 0.64),
    `${target.label}: World is not horizontally dominant (${box.width}px)`,
  );
  assert(
    box.height >= target.viewport.height * (mobile ? 0.68 : 0.56),
    `${target.label}: World is not vertically dominant (${box.height}px)`,
  );
  assert(
    (await page.getByLabel("Вид карты").count()) === 0,
    `${target.label}: rejected Phase 5 map selector is still visible`,
  );
}
async function select(page, name) {
  await page.getByRole("button", { name: new RegExp(`^${name}:`) }).click();
  const inspector = page.getByRole("region", { name });
  await inspector.waitFor({ state: "visible" });
  return inspector;
}
async function reset(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "World" }).waitFor({ state: "visible" });
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch(channel ? { channel } : {});
try {
  for (const target of targets) {
    const context = await browser.newContext({
      viewport: target.viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1, name: "World" }).waitFor({ state: "visible" });
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
      });
      await assertNoOverflow(page, `${target.label} default`);
      await assertWorldDominant(page, target);
      if (target.states.includes("default")) await capture(page, target, "world-default");

      if (target.states.includes("research")) {
        const inspector = await select(page, "Research Lead");
        await assertNoOverflow(page, `${target.label} selected`);
        if (target.viewport.width <= 720) {
          const box = await inspector.boundingBox();
          assert(
            box && box.y > target.viewport.height * 0.35,
            `${target.label}: selected agent is not presented as a bottom sheet`,
          );
          assert(
            box.width >= target.viewport.width - 24,
            `${target.label}: bottom sheet is too narrow`,
          );
        }
        await capture(
          page,
          target,
          target.viewport.width <= 720
            ? "world-research-lead-bottom-sheet"
            : "world-research-lead-selected",
        );
      }

      if (target.states.includes("reviewer")) {
        await select(page, "Reviewer");
        await capture(page, target, "world-reviewer-selected");
      }

      if (target.states.includes("handoff")) {
        await reset(page);
        await page.getByRole("button", { name: "Показать передачу" }).click();
        await page.locator("[data-handoff-cue]").waitFor({ state: "visible" });
        assert(
          (await page.locator("[data-handoff-cue]").count()) === 1,
          `${target.label}: expected exactly one canonical handoff cue`,
        );
        await capture(page, target, "world-active-handoff");
      }

      if (target.states.includes("activity")) {
        await reset(page);
        await select(page, "Research Lead");
        await page
          .getByText("Verify protocol contract", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        await capture(page, target, "world-active-activity");
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Phase 6 AI Town visual evidence written to ${outputDir}`);
