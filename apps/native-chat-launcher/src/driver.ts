import { isAbsolute, relative, resolve } from "node:path";
import {
  BrowserProfileRefSchema,
  type NativeChatLaunchClaim,
  NativeChatLaunchClaimSchema,
} from "@agent-world/domain";
import { type BrowserContext, chromium, type Page } from "playwright-core";

export type NativeChatBrowserDriver = {
  submit(claim: NativeChatLaunchClaim): Promise<void>;
  close(): Promise<void>;
};

export type NativeChatBrowserFailureCode =
  | "BROWSER_PROFILE_UNAVAILABLE"
  | "CHAT_COMPOSER_UNAVAILABLE"
  | "CHAT_SUBMISSION_UNCONFIRMED";

export class NativeChatBrowserError extends Error {
  constructor(readonly code: NativeChatBrowserFailureCode) {
    super(code);
    this.name = "NativeChatBrowserError";
  }
}

type ContextEntry = { context: BrowserContext; retainedPages: Set<Page> };

type ComposerLocator = {
  waitFor(options: { state: "visible"; timeout: number }): Promise<void>;
  fill(value: string): Promise<void>;
  click(options: { timeout: number }): Promise<void>;
};

export type NativeChatSubmissionPage = {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  locator(selector: string): ComposerLocator;
  waitForURL(predicate: (url: URL) => boolean, options: { timeout: number }): Promise<unknown>;
};

export async function submitRunId(
  page: NativeChatSubmissionPage,
  launchUrl: string,
  runId: string,
): Promise<void> {
  await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const composer = page.locator("#prompt-textarea");
  try {
    await composer.waitFor({ state: "visible", timeout: 20_000 });
    await composer.fill(runId);
  } catch {
    throw new NativeChatBrowserError("CHAT_COMPOSER_UNAVAILABLE");
  }
  try {
    const send = page.locator('[data-testid="send-button"]');
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await send.click({ timeout: 10_000 });
    await page.waitForURL((url) => url.hostname === "chatgpt.com" && url.pathname.includes("/c/"), {
      timeout: 15_000,
    });
  } catch {
    throw new NativeChatBrowserError("CHAT_SUBMISSION_UNCONFIRMED");
  }
}

export class PlaywrightNativeChatBrowserDriver implements NativeChatBrowserDriver {
  private readonly contexts = new Map<string, ContextEntry>();

  constructor(
    private readonly profileRoot: string,
    private readonly options: { retentionMs?: number } = {},
  ) {
    if (!isAbsolute(profileRoot)) throw new TypeError("Native Chat profile root must be absolute");
  }

  async submit(claimInput: NativeChatLaunchClaim): Promise<void> {
    const claim = NativeChatLaunchClaimSchema.parse(claimInput);
    const entry = await this.context(claim.profileRef);
    const page = await entry.context.newPage();
    entry.retainedPages.add(page);
    try {
      await submitRunId(page, claim.launchUrl, claim.message.runId);
      const retentionMs = this.options.retentionMs ?? 30 * 60_000;
      const timer = setTimeout(() => {
        entry.retainedPages.delete(page);
        void page.close().catch(() => undefined);
      }, retentionMs);
      timer.unref();
    } catch (error) {
      entry.retainedPages.delete(page);
      await page.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    const entries = [...this.contexts.values()];
    this.contexts.clear();
    await Promise.all(entries.map(({ context }) => context.close().catch(() => undefined)));
  }

  private async context(profileRefInput: string): Promise<ContextEntry> {
    const profileRef = BrowserProfileRefSchema.parse(profileRefInput);
    const existing = this.contexts.get(profileRef);
    if (existing) return existing;
    const profileDirectory = resolve(this.profileRoot, profileRef);
    const escaped = relative(this.profileRoot, profileDirectory);
    if (escaped.startsWith("..") || isAbsolute(escaped)) {
      throw new NativeChatBrowserError("BROWSER_PROFILE_UNAVAILABLE");
    }
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, {
        channel: "chrome",
        headless: false,
        viewport: null,
      });
      const entry = { context, retainedPages: new Set<Page>() };
      this.contexts.set(profileRef, entry);
      return entry;
    } catch {
      throw new NativeChatBrowserError("BROWSER_PROFILE_UNAVAILABLE");
    }
  }
}
