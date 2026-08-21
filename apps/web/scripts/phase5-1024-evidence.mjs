import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.AGENT_WORLD_EVIDENCE_BASE_URL ?? "http://127.0.0.1:3210";
const outputDir =
  process.env.AGENT_WORLD_1024_OUTPUT_DIR ??
  join(process.cwd(), "apps/web/test-results/phase5-1024-evidence");
const chromeChannel =
  process.env.AGENT_WORLD_PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined;
const diagnosticLabel = process.env.AGENT_WORLD_1024_DIAGNOSTIC_LABEL ?? "current";

const trackedProperties = [
  "display",
  "position",
  "top",
  "padding",
  "margin",
  "min-height",
  "background",
  "box-shadow",
  "grid-template-columns",
  "gap",
  "transform",
  "width",
  "height",
];

async function settleAtTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
      ),
  );
}

async function capture(page, name) {
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    path: join(outputDir, name),
  });
}

async function collectDiagnostics(page, stage) {
  return page.evaluate(
    ({ stageName, properties }) => {
      const styleValue = (style, property) => style.getPropertyValue(property);
      const rectValue = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      };
      const rulesFor = (element) => {
        if (!element) return [];
        const matches = [];
        let order = 0;
        const visit = (rules, sheet, mediaStack = []) => {
          for (const rule of rules) {
            order += 1;
            if (rule instanceof CSSMediaRule) {
              if (window.matchMedia(rule.conditionText).matches) {
                visit(rule.cssRules, sheet, [...mediaStack, rule.conditionText]);
              }
              continue;
            }
            if (!(rule instanceof CSSStyleRule)) continue;
            let matched = false;
            try {
              matched = element.matches(rule.selectorText);
            } catch {
              matched = false;
            }
            if (!matched) continue;
            const declarations = {};
            for (const property of properties) {
              const value = rule.style.getPropertyValue(property);
              if (value) {
                declarations[property] = {
                  value,
                  priority: rule.style.getPropertyPriority(property),
                };
              }
            }
            if (Object.keys(declarations).length > 0) {
              matches.push({
                order,
                selector: rule.selectorText,
                media: mediaStack,
                sheet: sheet.href ?? "inline",
                declarations,
              });
            }
          }
        };
        for (const sheet of document.styleSheets) {
          try {
            visit(sheet.cssRules, sheet);
          } catch {
            matches.push({
              order: -1,
              selector: "<unreadable stylesheet>",
              media: [],
              sheet: sheet.href ?? "inline",
              declarations: {},
            });
          }
        }
        return matches;
      };
      const read = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return null;
        const style = getComputedStyle(element);
        return {
          selector,
          tagName: element.tagName,
          className:
            typeof element.className === "string"
              ? element.className
              : element.getAttribute("class"),
          rect: rectValue(element),
          computed: Object.fromEntries(
            properties.map((property) => [property, styleValue(style, property)]),
          ),
          matchingRules: rulesFor(element),
        };
      };

      return {
        stage: stageName,
        window: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
        },
        elements: {
          workspaceGrid: read(".workspace-grid"),
          worldPanel: read("#world-panel"),
          inspector: read("#world-panel + .inspector"),
          worldLayout: read(".workspace-grid"),
          inspectorHero: read("#world-panel + .inspector > div:first-child"),
          inspectorPortrait: read("#world-panel + .inspector > div:first-child > div:first-child"),
          inspectorPawn: read("#world-panel + .inspector .office-pawn"),
          drawerBackdrop: read(".drawer-backdrop"),
          taskDialog: read('.drawer-backdrop [role="dialog"]'),
        },
      };
    },
    { stageName: stage, properties: trackedProperties },
  );
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch(chromeChannel ? { channel: chromeChannel } : {});
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "World" }).waitFor({ state: "visible" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  await settleAtTop(page);
  await capture(page, "phase5-1024x768-world-default-top.png");

  const researchAgent = page
    .locator(".openclaw-office-world")
    .getByRole("button", { name: /^Research Lead:/ });
  await researchAgent.click();
  await page.getByRole("region", { name: "Research Lead" }).waitFor({ state: "visible" });
  await settleAtTop(page);

  const selectedDiagnostics = await collectDiagnostics(page, "world-selected-top");
  await capture(page, "phase5-1024x768-world-selected-research-top.png");

  const taskButton = page
    .getByRole("region", { name: "Research Lead" })
    .getByRole("button", { name: "Назначить задачу" });
  const beforeTaskScrollY = await page.evaluate(() => window.scrollY);
  await taskButton.click();
  const taskDialog = page.getByRole("dialog", { name: "Задача для Research Lead" });
  await taskDialog.waitFor({ state: "visible" });
  const afterTaskOpenScrollY = await page.evaluate(() => window.scrollY);
  const taskOpenDiagnostics = await collectDiagnostics(page, "task-open-before-scroll-reset");
  await settleAtTop(page);
  const taskTopDiagnostics = await collectDiagnostics(page, "task-open-top");
  await capture(page, "phase5-1024x768-task-drawer.png");

  const diagnostics = {
    label: diagnosticLabel,
    beforeTaskScrollY,
    afterTaskOpenScrollY,
    selected: selectedDiagnostics,
    taskOpen: taskOpenDiagnostics,
    taskTop: taskTopDiagnostics,
  };
  await writeFile(
    join(outputDir, `phase5-1024-diagnostics-${diagnosticLabel}.json`),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  );
  console.log(`PHASE5_1024_DIAGNOSTICS ${JSON.stringify(diagnostics)}`);
} finally {
  await context.close();
  await browser.close();
}

console.log(`Phase 5 deterministic 1024 evidence written to ${outputDir}`);
