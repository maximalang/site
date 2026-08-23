import { describe, expect, it, vi } from "vitest";
import { createModelRouteCheckHandler } from "./model-route-check-http";

const modelRouteId = "model_route_22222222-2222-2222-2222-222222222222";
function request(origin = "https://world.test") {
  return new Request("https://world.test/api/hub/model-routes/check", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, modelRouteId }),
  });
}

describe("model route check HTTP", () => {
  it("returns a strict provenance receipt for an authorized real check", async () => {
    const check = vi.fn(async () => ({
      schemaVersion: 1,
      runId: "run_11111111-1111-1111-1111-111111111111",
      modelRouteId,
      providerId: "provider_33333333-3333-3333-3333-333333333333",
      accountId: "account_44444444-4444-4444-4444-444444444444",
      mode: "API",
      remoteModelId: "anthropic/test-model",
      status: "SUCCEEDED",
      usage: { inputTokens: 6, outputTokens: 1, totalTokens: 7 },
    }));
    const response = await createModelRouteCheckHandler({ authorize: async () => true, check })(
      request(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modelRouteId,
      mode: "API",
      remoteModelId: "anthropic/test-model",
      status: "SUCCEEDED",
    });
    expect(check).toHaveBeenCalledWith(modelRouteId);
  });

  it("authorizes before parsing and rejects cross-origin requests", async () => {
    const check = vi.fn();
    expect(
      (await createModelRouteCheckHandler({ authorize: async () => false, check })(request()))
        .status,
    ).toBe(401);
    expect(
      (
        await createModelRouteCheckHandler({ authorize: async () => true, check })(
          request("https://evil.test"),
        )
      ).status,
    ).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });

  it.each([
    "UPSTREAM_AUTH",
    "RATE_LIMITED",
    "TIMEOUT",
    "UPSTREAM_UNAVAILABLE",
    "INVALID_UPSTREAM_RESPONSE",
  ])("normalizes %s without reflecting upstream details or credentials", async (failure) => {
    const secret = "sk-or-super-secret";
    const upstream = `${failure}: OpenRouter rejected Authorization: Bearer ${secret}`;
    const response = await createModelRouteCheckHandler({
      authorize: async () => true,
      check: async () => {
        throw new Error(upstream);
      },
    })(request());
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(body).toBe('{"error":{"code":"MODEL_ROUTE_CHECK_FAILED"}}');
    expect(body).not.toContain(secret);
    expect(body).not.toContain(failure);
    expect(body).not.toContain("OpenRouter rejected");
  });
});