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

let screenshotCount = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
async function capture(page, target, name) {
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: join(outputDir, `phase6-${target.label}-${name}.png`),
  });
  screenshotCount += 1;
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
async function boxOf(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label}: no geometry`);
  return box;
}
async function assertFixtureStrip(page, target) {
  const fixture = page.locator(".fixture-banner");
  const renderer = page.locator('[data-renderer="agent-world-canvas-v1"]');
  if ((await fixture.count()) === 0) return;
  const fixtureBox = await boxOf(fixture, `${target.label} fixture warning`);
  const rendererBox = await boxOf(renderer, `${target.label} renderer`);
  assert(
    fixtureBox.y + fixtureBox.height <= rendererBox.y + 1,
    `${target.label}: fixture warning overlaps the World HUD`,
  );
  const worldTitle = renderer.getByText("Agent World", { exact: true });
  const wholeWorld = renderer.getByRole("button", { name: "Весь мир" });
  const titleBox = await boxOf(worldTitle, `${target.label} World title`);
  const controlBox = await boxOf(wholeWorld, `${target.label} whole-world control`);
  assert(
    !overlaps(fixtureBox, titleBox),
    `${target.label}: fixture warning covers Agent World title`,
  );
  assert(
    !overlaps(fixtureBox, controlBox),
    `${target.label}: fixture warning covers World controls`,
  );
}
async function assertWorldDominant(page, target, selected = false) {
  const renderer = page.locator('[data-renderer="agent-world-canvas-v1"]');
  const canvas = page.getByTestId("agent-world-canvas");
  await renderer.waitFor({ state: "visible" });
  await canvas.waitFor({ state: "visible" });
  const rendererBox = await renderer.boundingBox();
  const box = await canvas.boundingBox();
  assert(rendererBox, `${target.label}: renderer has no geometry`);
  assert(box, `${target.label}: canvas has no geometry`);
  const mobile = target.viewport.width <= 720;
  const minimumViewportShare = selected && !mobile ? 0.68 : 0.94;
  assert(
    box.width >= rendererBox.width - 1,
    `${target.label}: canvas does not fill available renderer width (${box.width}/${rendererBox.width}px)`,
  );
  assert(
    rendererBox.width >= target.viewport.width * minimumViewportShare,
    `${target.label}: World is not horizontally dominant (${rendererBox.width}px)`,
  );
  assert(
    box.height >= target.viewport.height * (mobile ? 0.68 : 0.7),
    `${target.label}: World is not vertically dominant (${box.height}px)`,
  );
  const lowerDeadRegion = target.viewport.height - (box.y + box.height);
  assert(
    lowerDeadRegion <= target.viewport.height * 0.02,
    `${target.label}: World leaves a material lower dead region (${lowerDeadRegion}px)`,
  );
  assert(
    (await page.getByLabel("Вид карты").count()) === 0,
    `${target.label}: rejected Phase 5 map selector is still visible`,
  );
  await assertFixtureStrip(page, target);
}
async function assertSelectedGeometry(page, target, name) {
  const renderer = page.locator('[data-renderer="agent-world-canvas-v1"]');
  const canvas = page.getByTestId("agent-world-canvas");
  const agentButton = page.getByRole("button", { name: new RegExp(`^${name}:`) });
  const inspector = page.getByRole("region", { name });
  const agentRail = page.getByRole("navigation", { name: "Агенты мира" });
  const rendererBox = await boxOf(renderer, `${target.label} renderer`);
  const canvasBox = await boxOf(canvas, `${target.label} canvas`);
  const agentButtonBox = await boxOf(agentButton, `${target.label} selected agent button`);
  const inspectorBox = await boxOf(inspector, `${target.label} inspector`);
  const railBox = await boxOf(agentRail, `${target.label} agent rail`);
  if (target.viewport.width <= 720) {
    console.log(
      `PHASE6_MOBILE_GEOMETRY ${JSON.stringify({
        viewport: target.label,
        renderer: rendererBox,
        canvas: canvasBox,
        rail: railBox,
        selectedAgentButton: agentButtonBox,
        inspector: inspectorBox,
        gap: railBox.y - (inspectorBox.y + inspectorBox.height),
      })}`,
    );
  }
  assert(
    !overlaps(inspectorBox, railBox),
    `${target.label}: selected inspector intersects the agent rail`,
  );
  if (target.viewport.width <= 720) {
    assert(
      inspectorBox.y + inspectorBox.height <= railBox.y - 4,
      `${target.label}: bottom sheet does not reserve the bottom HUD rail`,
    );
    assert(
      inspectorBox.y > target.viewport.height * 0.35,
      `${target.label}: selected agent is not presented as a bottom sheet`,
    );
    assert(
      inspectorBox.width >= target.viewport.width - 24,
      `${target.label}: bottom sheet is too narrow`,
    );
  }
  const actionable = await agentButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || (hit instanceof Node && button.contains(hit));
  });
  assert(actionable, `${target.label}: selected agent control is covered after opening inspector`);
}
async function select(page, name) {
  const agent = page.getByRole("button", { name: new RegExp(`^${name}:`) });
  await agent.click();
  const inspector = page.getByRole("region", { name });
  await inspector.waitFor({ state: "visible" });
  return { agent, inspector };
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
      assert(
        await page.locator(".empty-inspector").isHidden(),
        `${target.label}: empty inspector still reserves default World width`,
      );
      if (target.states.includes("default")) await capture(page, target, "world-default");

      if (target.states.includes("research")) {
        const { agent } = await select(page, "Research Lead");
        await assertNoOverflow(page, `${target.label} selected`);
        await assertWorldDominant(page, target, true);
        await assertSelectedGeometry(page, target, "Research Lead");
        await capture(
          page,
          target,
          target.viewport.width <= 720
            ? "world-research-lead-bottom-sheet"
            : "world-research-lead-selected",
        );
        await agent.dblclick();
        await page.getByRole("dialog", { name: "Research Lead" }).waitFor({ state: "visible" });
        await reset(page);
      }

      if (target.states.includes("reviewer")) {
        await select(page, "Reviewer");
        await assertSelectedGeometry(page, target, "Reviewer");
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
        await assertFixtureStrip(page, target);
        await capture(page, target, "world-active-handoff");
      }

      if (target.states.includes("activity")) {
        await reset(page);
        await select(page, "Research Lead");
        await page
          .getByText("Verify protocol contract", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        await assertSelectedGeometry(page, target, "Research Lead");
        await capture(page, target, "world-active-activity");
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert(
  screenshotCount === 12,
  `Expected exactly 12 Phase 6 screenshots, received ${screenshotCount}`,
);
console.log(
  `Phase 6 AI Town visual evidence written to ${outputDir} (${screenshotCount} screenshots)`,
);