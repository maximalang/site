import { isAbsolute } from "node:path";
import {
  AccountIdSchema,
  BrowserProfileRefSchema,
  LauncherIdSchema,
  NativeChatLaunchUrlSchema,
} from "@agent-world/domain";
import { PostgresNativeChatLaunchStore } from "@agent-world/postgres-store";
import pg from "pg";
import * as z from "zod";
import { PlaywrightNativeChatBrowserDriver } from "./driver.js";
import { NativeChatLauncherWorker } from "./worker.js";

const { Pool } = pg;

const EnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().url().startsWith("postgresql://").max(2_048),
    AGENT_WORLD_DATABASE_TLS: z.enum(["require", "disable"]).default("require"),
    AGENT_WORLD_DATABASE_PLAINTEXT_ACK: z.literal("private-network").optional(),
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
    AGENT_WORLD_NATIVE_CHAT_ACCOUNT_ID: AccountIdSchema.optional(),
    AGENT_WORLD_NATIVE_CHAT_PROFILE_REF: BrowserProfileRefSchema.optional(),
    AGENT_WORLD_NATIVE_CHAT_LAUNCH_URL: NativeChatLaunchUrlSchema.optional(),
  })
  .superRefine((environment, context) => {
    if (!isAbsolute(environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_ROOT)) {
      context.addIssue({ code: "custom", message: "Native Chat profile root must be absolute" });
    }
    if (
      environment.AGENT_WORLD_DATABASE_TLS === "disable" &&
      environment.AGENT_WORLD_DATABASE_PLAINTEXT_ACK !== "private-network"
    ) {
      context.addIssue({ code: "custom", message: "Plaintext database requires acknowledgement" });
    }
    const profileValues = [
      environment.AGENT_WORLD_NATIVE_CHAT_ACCOUNT_ID,
      environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_REF,
      environment.AGENT_WORLD_NATIVE_CHAT_LAUNCH_URL,
    ];
    if (profileValues.some(Boolean) && !profileValues.every(Boolean)) {
      context.addIssue({
        code: "custom",
        message: "Account, profile ref and launch URL must be configured together",
      });
    }
  });

function boundedLog(event: string, outcome: string, identifiers: Record<string, string> = {}) {
  process.stdout.write(`${JSON.stringify({ event, outcome, ...identifiers })}\n`);
}

const environment = EnvironmentSchema.parse(process.env);
const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 3_000,
  ssl: environment.AGENT_WORLD_DATABASE_TLS === "require" ? { rejectUnauthorized: true } : false,
});
const store = new PostgresNativeChatLaunchStore(pool);
if (
  environment.AGENT_WORLD_NATIVE_CHAT_ACCOUNT_ID &&
  environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_REF &&
  environment.AGENT_WORLD_NATIVE_CHAT_LAUNCH_URL
) {
  await store.configureProfile({
    accountId: environment.AGENT_WORLD_NATIVE_CHAT_ACCOUNT_ID,
    profileRef: environment.AGENT_WORLD_NATIVE_CHAT_PROFILE_REF,
    launchUrl: environment.AGENT_WORLD_NATIVE_CHAT_LAUNCH_URL,
    isEnabled: true,
    updatedAt: new Date().toISOString(),
  });
}
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
await pool.end();
