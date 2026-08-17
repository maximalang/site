import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { LauncherIdSchema } from "@agent-world/domain";
import * as z from "zod";
import { PlaywrightNativeChatBrowserDriver } from "./driver.js";
import { HttpNativeChatLaunchStore, parseNativeChatLauncherControlUrl } from "./http-store.js";
import { NativeChatLauncherWorker } from "./worker.js";

const EnvironmentSchema = z.object({
  AGENT_WORLD_NATIVE_CHAT_CONTROL_URL: z.string().url().max(2_048),
  AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_FILE: z.string().trim().min(1).max(4_096),
  AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID: LauncherIdSchema,
  AGENT_WORLD_NATIVE_CHAT_PROFILE_ROOT: z.string().trim().min(1).max(4_096),
  AGENT_WORLD_NATIVE_CHAT_LEASE_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(300_000)
    .default(120_000),
  AGENT_WORLD_NATIVE_CHAT_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  AGENT_WORLD_NATIVE_CHAT_PAGE_RETENTION_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60_000)
    .default(30 * 60_000),
  AGENT_WORLD_NATIVE_CHAT_ONCE: z.enum(["true", "false"]).default("false"),
});

function readLauncherToken(path: string): string {
  if (!isAbsolute(path)) throw new Error("Native Chat launcher token file must be absolute");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 43 || stat.size > 256) {
    throw new Error("Native Chat launcher token file violates the local secret contract");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new Error("Native Chat launcher token must be canonical base64url");
  }
  return token;
}

function boundedLog(event: string, outcome: string, identifiers: Record<string, string> = {}) {
  process.stdout.write(`${JSON.stringify({ event, outcome, ...identifiers })}\n`);
}

const environment = EnvironmentSchema.parse(process.env);
if (!isAbsolute(environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_ROOT)) {
  throw new Error("Native Chat profile root must be absolute");
}
const store = new HttpNativeChatLaunchStore({
  controlUrl: parseNativeChatLauncherControlUrl(environment.AGENT_WORLD_NATIVE_CHAT_CONTROL_URL),
  token: readLauncherToken(environment.AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_FILE),
});
const browser = new PlaywrightNativeChatBrowserDriver(
  environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_ROOT,
  { retentionMs: environment.AGENT_WORLD_NATIVE_CHAT_PAGE_RETENTION_MS },
);
const worker = new NativeChatLauncherWorker({
  store,
  browser,
  launcherId: environment.AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID,
  leaseMs: environment.AGENT_WORLD_NATIVE_CHAT_LEASE_MS,
});

let stopping = false;
const stop = () => {
  stopping = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

do {
  try {
    const result = await worker.runOnce();
    if (result.outcome !== "IDLE") {
      boundedLog("native_chat_launcher_cycle", result.outcome, {
        ...(result.claim
          ? { dispatch_id: result.claim.dispatchId, run_id: result.claim.message.runId }
          : {}),
      });
    }
  } catch {
    boundedLog("native_chat_launcher_cycle", "UNAVAILABLE");
  }
  if (!stopping && environment.AGENT_WORLD_NATIVE_CHAT_ONCE !== "true") {
    await new Promise((resolve) =>
      setTimeout(resolve, environment.AGENT_WORLD_NATIVE_CHAT_POLL_MS),
    );
  }
} while (!stopping && environment.AGENT_WORLD_NATIVE_CHAT_ONCE !== "true");

await browser.close();
