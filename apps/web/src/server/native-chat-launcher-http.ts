import { createHash, timingSafeEqual } from "node:crypto";
import {
  ChatDispatchIdSchema,
  LauncherIdSchema,
  type NativeChatLaunchClaim,
  NativeChatLaunchClaimSchema,
  type NativeChatSubmissionReceipt,
  NativeChatSubmissionReceiptSchema,
} from "@agent-world/domain";
import { NativeChatLaunchStoreError } from "@agent-world/postgres-store";
import * as z from "zod";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const MAX_BODY_BYTES = 2_048;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

const ConfigurationSchema = z.strictObject({
  launcherId: LauncherIdSchema,
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const ClaimRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  action: z.literal("CLAIM"),
  leaseMs: z.number().int().min(10_000).max(300_000),
});
const SubmittedRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  action: z.literal("SUBMITTED"),
  dispatchId: ChatDispatchIdSchema,
  attempt: z.number().int().min(1).max(10),
});
const FailureRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  action: z.literal("FAILURE"),
  dispatchId: ChatDispatchIdSchema,
  attempt: z.number().int().min(1).max(10),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retryable: z.boolean(),
});
const RequestSchema = z.discriminatedUnion("action", [
  ClaimRequestSchema,
  SubmittedRequestSchema,
  FailureRequestSchema,
]);

type RuntimeEnvironment = Record<string, string | undefined>;

export type NativeChatLauncherControlConfiguration = z.infer<typeof ConfigurationSchema>;

export type NativeChatLauncherHttpDependencies = {
  claim(input: {
    launcherId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }): Promise<NativeChatLaunchClaim | undefined>;
  submitted(input: {
    dispatchId: string;
    launcherId: string;
    attempt: number;
    submittedAt: string;
  }): Promise<NativeChatSubmissionReceipt>;
  failure(input: {
    dispatchId: string;
    launcherId: string;
    attempt: number;
    failedAt: string;
    failureCode: string;
    retryable: boolean;
  }): Promise<"RETRY" | "FAILED">;
  now?: () => Date;
};

export function parseNativeChatLauncherControlConfiguration(
  environment: RuntimeEnvironment,
): NativeChatLauncherControlConfiguration | undefined {
  const launcherId = environment.AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID?.trim();
  const tokenSha256 = environment.AGENT_WORLD_NATIVE_CHAT_LAUNCHER_TOKEN_SHA256?.trim();
  if (!launcherId && !tokenSha256) return undefined;
  if (!launcherId || !tokenSha256) {
    throw new Error("Native Chat launcher control configuration is incomplete");
  }
  return ConfigurationSchema.parse({ launcherId, tokenSha256 });
}

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: RESPONSE_HEADERS });
}

function authorized(
  request: Request,
  configuration: NativeChatLauncherControlConfiguration,
): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (!TOKEN_PATTERN.test(token)) return false;
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(configuration.tokenSha256, "hex");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

async function readRequest(request: Request): Promise<z.infer<typeof RequestSchema>> {
  if (request.method !== "POST") throw new Error("Invalid method");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Invalid content type");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw new Error("Invalid content length");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("Request body is too large");
  }
  return RequestSchema.parse(JSON.parse(text) as unknown);
}

export function createNativeChatLauncherRouteHandler(
  dependencies: NativeChatLauncherHttpDependencies,
  configuration: NativeChatLauncherControlConfiguration | undefined,
) {
  return async (request: Request): Promise<Response> => {
    if (!configuration) return error("LAUNCHER_CONTROL_DISABLED", 503);
    if (!authorized(request, configuration)) return error("UNAUTHORIZED", 401);

    let input: z.infer<typeof RequestSchema>;
    try {
      input = await readRequest(request);
    } catch {
      return error("INVALID_REQUEST", 400);
    }

    const now = dependencies.now ?? (() => new Date());
    try {
      if (input.action === "CLAIM") {
        const claimedAt = now();
        const claim = await dependencies.claim({
          launcherId: configuration.launcherId,
          claimedAt: claimedAt.toISOString(),
          leaseExpiresAt: new Date(claimedAt.getTime() + input.leaseMs).toISOString(),
        });
        return Response.json(
          {
            schemaVersion: 1,
            claim: claim ? NativeChatLaunchClaimSchema.parse(claim) : null,
          },
          { status: 200, headers: RESPONSE_HEADERS },
        );
      }
      if (input.action === "SUBMITTED") {
        const receipt = await dependencies.submitted({
          dispatchId: input.dispatchId,
          launcherId: configuration.launcherId,
          attempt: input.attempt,
          submittedAt: now().toISOString(),
        });
        return Response.json(NativeChatSubmissionReceiptSchema.parse(receipt), {
          status: 200,
          headers: RESPONSE_HEADERS,
        });
      }
      const outcome = await dependencies.failure({
        dispatchId: input.dispatchId,
        launcherId: configuration.launcherId,
        attempt: input.attempt,
        failedAt: now().toISOString(),
        failureCode: input.failureCode,
        retryable: input.retryable,
      });
      return Response.json(
        { schemaVersion: 1, outcome },
        { status: 200, headers: RESPONSE_HEADERS },
      );
    } catch (cause) {
      if (cause instanceof NativeChatLaunchStoreError) return error(cause.code, 409);
      return error("LAUNCHER_CONTROL_UNAVAILABLE", 503);
    }
  };
}
