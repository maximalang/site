import { SecretStoreError } from "@agent-world/postgres-store";
import { describe, expect, it, vi } from "vitest";
import { createProviderCredentialRouteHandler } from "./provider-credential-http";

const body = {
  schemaVersion: 1,
  commandId: "provider-key-write-1",
  accountId: "account_33333333-3333-3333-3333-333333333333",
  apiKey: "provider-super-secret",
};

function request(value: unknown = body) {
  return new Request("https://world.test/api/hub/provider-credentials", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://world.test" },
    body: JSON.stringify(value),
  });
}

describe("provider credential HTTP", () => {
  it("authorizes before parsing and returns only a secret-free receipt", async () => {
    const write = vi.fn(async () => ({ outcome: "CREATED" as const, version: 1 }));
    const handler = createProviderCredentialRouteHandler({ authorize: async () => true, write });
    const response = await handler(request());
    expect(response.status).toBe(201);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      schemaVersion: 1,
      outcome: "CREATED",
      accountId: body.accountId,
      credentialConfigured: true,
      version: 1,
    });
    expect(JSON.stringify(responseBody)).not.toContain(body.apiKey);
    expect(write).toHaveBeenCalledWith({
      commandId: body.commandId,
      accountId: body.accountId,
      plaintext: body.apiKey,
      writtenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("rejects unauthorized, cross-origin and malformed writes", async () => {
    const write = vi.fn();
    expect(
      (
        await createProviderCredentialRouteHandler({ authorize: async () => false, write })(
          request(),
        )
      ).status,
    ).toBe(401);
    const crossOrigin = request();
    crossOrigin.headers.set("origin", "https://evil.test");
    expect(
      (
        await createProviderCredentialRouteHandler({ authorize: async () => true, write })(
          crossOrigin,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await createProviderCredentialRouteHandler({ authorize: async () => true, write })(
          request({ ...body, extra: "rejected" }),
        )
      ).status,
    ).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it("maps safe store failures without reflecting the key", async () => {
    const handler = createProviderCredentialRouteHandler({
      authorize: async () => true,
      write: async () => {
        throw new SecretStoreError("INVALID_REFERENCE");
      },
    });
    const response = await handler(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "INVALID_REFERENCE" } });
  });
});
