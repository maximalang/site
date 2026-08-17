import {
  type NativeChatLaunchClaim,
  NativeChatLaunchClaimSchema,
  type NativeChatSubmissionReceipt,
  NativeChatSubmissionReceiptSchema,
} from "@agent-world/domain";
import * as z from "zod";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

const ClaimResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  claim: NativeChatLaunchClaimSchema.nullable(),
});
const FailureResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["RETRY", "FAILED"]),
});

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseNativeChatLauncherControlUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/native-chat-launcher" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
  ) {
    throw new Error("Native Chat launcher control URL violates the HTTPS endpoint contract");
  }
  return url.toString();
}

export class HttpNativeChatLaunchStore {
  private readonly controlUrl: string;
  private readonly token: string;

  constructor(input: { controlUrl: string; token: string; timeoutMs?: number }) {
    this.controlUrl = parseNativeChatLauncherControlUrl(input.controlUrl);
    if (!TOKEN_PATTERN.test(input.token)) throw new Error("Invalid launcher control token");
    this.token = input.token;
    this.timeoutMs = input.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 60_000) {
      throw new Error("Invalid launcher control timeout");
    }
  }

  private readonly timeoutMs: number;

  private async post(body: unknown): Promise<unknown> {
    const response = await fetch(this.controlUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Launcher control rejected request with status ${response.status}`);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
      throw new Error("Launcher control response is oversized");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Launcher control response is oversized");
    }
    return JSON.parse(text) as unknown;
  }

  async claimNext(input: {
    launcherId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }): Promise<NativeChatLaunchClaim | undefined> {
    const leaseMs = Date.parse(input.leaseExpiresAt) - Date.parse(input.claimedAt);
    if (!Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 300_000) {
      throw new Error("Invalid launcher lease duration");
    }
    const response = ClaimResponseSchema.parse(
      await this.post({ schemaVersion: 1, action: "CLAIM", leaseMs }),
    );
    if (response.claim && response.claim.launcherId !== input.launcherId) {
      throw new Error("Launcher control returned a claim for a different launcher");
    }
    return response.claim ?? undefined;
  }

  async markSubmitted(input: {
    dispatchId: string;
    launcherId: string;
    attempt: number;
    submittedAt: string;
  }): Promise<NativeChatSubmissionReceipt> {
    const receipt = NativeChatSubmissionReceiptSchema.parse(
      await this.post({
        schemaVersion: 1,
        action: "SUBMITTED",
        dispatchId: input.dispatchId,
        attempt: input.attempt,
      }),
    );
    if (receipt.launcherId !== input.launcherId) {
      throw new Error("Launcher control returned a receipt for a different launcher");
    }
    return receipt;
  }

  async recordFailure(input: {
    dispatchId: string;
    launcherId: string;
    attempt: number;
    failedAt: string;
    failureCode: string;
    retryable: boolean;
  }): Promise<"RETRY" | "FAILED"> {
    const response = FailureResponseSchema.parse(
      await this.post({
        schemaVersion: 1,
        action: "FAILURE",
        dispatchId: input.dispatchId,
        attempt: input.attempt,
        failureCode: input.failureCode,
        retryable: input.retryable,
      }),
    );
    return response.outcome;
  }
}
