import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.AGENT_WORLD_EVIDENCE_BASE_URL ?? "http://127.0.0.1:3210";
const outputDir = join(process.cwd(), "apps/web/test-results/phase5-visual-evidence");
const chromeChannel = process.env.AGENT_WORLD_PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined;

const targets = [
  {
    label: "1440x1000",
    viewport: { width: 1440, height: 1000 },
    world: ["default", "research", "reviewer", "space-station"],
    hub: ["registry", "setup", "runtime", "memory", "automation", "routing"],
  },
  {
    label: "390x844",
    viewport: { width: 390, height: 844 },
    world: ["default", "research", "space-station"],
    hub: ["registry", "setup", "runtime", "routing"],
  },
  {
    label: "320x720",
    viewport: { width: 320, height: 720 },
    world: ["default", "handoff", "research"],
    hub: ["registry", "routing"],
  },
];

const hubLabels = {
  registry: "Реестр",
  setup: "Настройка",
  runtime: "Runtime",
  memory: "Memory",
  automation: "Автоматизация",
  routing: "Маршруты",
};

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function capture(page, label, name) {
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: join(outputDir, `phase5-${label}-${name}.png`),
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (hasOverflow) throw new Error(`${label}: page has horizontal overflow`);
}

async function assertAgentNameReadable(page, name, label) {
  const locator = page
    .locator(".openclaw-office-world .office-agent-name")
    .filter({ hasText: name })
    .first();
  await locator.waitFor({ state: "visible" });
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    text: element.textContent?.trim(),
  }));
  if (metrics.text !== name) throw new Error(`${label}: expected full agent name ${name}`);
  if (metrics.scrollHeight > metrics.clientHeight + 1) {
    throw new Error(`${label}: agent name ${name} is vertically clipped`);
  }
}

async function assertMobileHandoff(page, label) {
  const handoffText = page.getByText("Research Lead → Reviewer", { exact: true });
  await handoffText.waitFor({ state: "visible" });

  const cueCount = await page.locator("[data-handoff-cue]").count();
  if (cueCount !== 1) {
    throw new Error(`${label}: expected one canonical handoff cue, received ${cueCount}`);
  }

  const feed = page.locator(".office-handoff-feed");
  const scene = page.locator(".openclaw-office-world");
  const feedBox = await feed.boundingBox();
  const sceneBox = await scene.boundingBox();
  if (!feedBox || !sceneBox) throw new Error(`${label}: handoff feed or scene has no layout box`);

  const withinScene =
    feedBox.x >= sceneBox.x - 1 &&
    feedBox.y >= sceneBox.y - 1 &&
    feedBox.x + feedBox.width <= sceneBox.x + sceneBox.width + 1 &&
    feedBox.y + feedBox.height <= sceneBox.y + sceneBox.height + 1;
  if (!withinScene) throw new Error(`${label}: handoff feed escapes the World scene`);

  const characterAndNameBoxes = await page
    .locator(".openclaw-office-world .office-pawn, .openclaw-office-world .office-agent-name")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
  if (characterAndNameBoxes.some((box) => overlaps(feedBox, box))) {
    throw new Error(`${label}: handoff feed overlaps a character or agent name`);
  }
}

async function selectWorldAgent(page, name) {
  const agent = page
    .locator(".openclaw-office-world")
    .getByRole("button", { name: new RegExp(`^${name}:`) });
  await agent.click();
  await page.getByRole("region", { name }).waitFor({ state: "visible" });
}

async function openHub(page) {
  await page.getByRole("tab", { name: "Hub", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Canonical Hub" }).waitFor({ state: "visible" });
}

async function selectHubSection(page, key) {
  const label = hubLabels[key];
  if (!label) throw new Error(`Unknown Hub evidence section: ${key}`);
  const tab = page.locator(".hub-section-nav").getByRole("tab", { name: label, exact: true });
  await tab.click();
  const selected = await tab.getAttribute("aria-selected");
  if (selected !== "true") throw new Error(`Hub section ${label} did not become selected`);
}

async function captureWorldEvidence(page, target) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "World" }).waitFor({ state: "visible" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });

  const scene = page.locator(".openclaw-office-world");
  await scene.waitFor({ state: "visible" });
  if ((await scene.getAttribute("data-skin")) !== "openclaw-office-open-floor-v1") {
    throw new Error(`${target.label}: default World is not OpenClaw Office`);
  }

  await assertNoHorizontalOverflow(page, `${target.label} World default`);
  await assertAgentNameReadable(page, "Research Lead", `${target.label} World default`);
  await assertAgentNameReadable(page, "Reviewer", `${target.label} World default`);
  if (target.viewport.width <= 390) await assertMobileHandoff(page, `${target.label} World default`);

  if (target.world.includes("default")) await capture(page, target.label, "world-default");
  if (target.world.includes("handoff")) await capture(page, target.label, "world-handoff-visible");

  if (target.world.includes("research")) {
    await selectWorldAgent(page, "Research Lead");
    await assertNoHorizontalOverflow(page, `${target.label} World Research Lead selected`);
    await capture(page, target.label, "world-research-lead-selected");
  }

  if (target.world.includes("reviewer")) {
    await selectWorldAgent(page, "Reviewer");
    await capture(page, target.label, "world-reviewer-selected");
  }

  if (target.world.includes("space-station")) {
    await page.locator("#world-skin").selectOption({ label: "Space Station" });
    await page.locator('.openclaw-office-world[data-theme="SPACE_STATION"]').waitFor({
      state: "visible",
    });
    await assertNoHorizontalOverflow(page, `${target.label} Space Station`);
    if (target.viewport.width <= 390) {
      await assertMobileHandoff(page, `${target.label} Space Station`);
    }
    await capture(page, target.label, "world-space-station");
  }
}

async function captureHubEvidence(page, target) {
  await openHub(page);
  await assertNoHorizontalOverflow(page, `${target.label} Hub Registry`);

  for (const key of target.hub) {
    await selectHubSection(page, key);
    await assertNoHorizontalOverflow(page, `${target.label} Hub ${key}`);
    await capture(page, target.label, `hub-${key}`);
  }
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch(chromeChannel ? { channel: chromeChannel } : {});

try {
  for (const target of targets) {
    const context = await browser.newContext({ viewport: target.viewport });
    const page = await context.newPage();
    try {
      await captureWorldEvidence(page, target);
      await captureHubEvidence(page, target);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`Phase 5 visual evidence written to ${outputDir}`);
