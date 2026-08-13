import { describe, expect, it } from "vitest";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";
import { PostgresModelRouteResolver, RouteResolutionError } from "./model-route-resolver.js";

const routeId = "model_route_22222222-2222-2222-2222-222222222222";

function poolWith(row: Record<string, unknown> | undefined): TransactionPool {
  const client: TransactionClient = {
    async query<Row>() {
      return { rows: (row ? [row] : []) as Row[] };
    },
    release() {},
  };
  return {
    connect: async () => client,
  };
}

const apiRoute = {
  model_route_id: routeId,
  remote_model_id: "gpt-5-mini",
  surface: "API",
  availability: "AVAILABLE",
  route_enabled: true,
  provider_id: "provider_11111111-1111-1111-1111-111111111111",
  provider_kind: "OPENAI",
  provider_category: "LLM_API",
  provider_base_url: null,
  provider_enabled: true,
  account_id: "account_33333333-3333-3333-3333-333333333333",
  account_health: "ACTIVE",
  account_enabled: true,
  credential_ref: "secret-store:provider/openai/api-key",
  secret_purpose: "PROVIDER_API_KEY",
};

describe("PostgresModelRouteResolver", () => {
  it("resolves one eligible API route without reading secret plaintext", async () => {
    const resolver = new PostgresModelRouteResolver(poolWith(apiRoute));
    await expect(resolver.resolve(routeId)).resolves.toEqual({
      schemaVersion: 1,
      modelRouteId: routeId,
      modelAlias: "route-model_route_22222222-2222-2222-2222-222222222222",
      providerKind: "OPENAI",
      providerModel: "openai/gpt-5-mini",
      credentialRef: "secret-store:provider/openai/api-key",
    });
  });

  it.each([
    ["missing", undefined],
    ["disabled route", { ...apiRoute, route_enabled: false }],
    ["degraded route", { ...apiRoute, availability: "DEGRADED" }],
    ["disabled provider", { ...apiRoute, provider_enabled: false }],
    ["unconfigured account", { ...apiRoute, account_health: "UNCONFIGURED" }],
    ["missing key reference", { ...apiRoute, credential_ref: null }],
    ["missing encrypted secret", { ...apiRoute, secret_purpose: null }],
  ])("fails closed for %s", async (_label, row) => {
    const resolver = new PostgresModelRouteResolver(poolWith(row));
    await expect(resolver.resolve(routeId)).rejects.toBeInstanceOf(RouteResolutionError);
  });

  it("allows a local route only when its exact origin is operator-allowlisted", async () => {
    const localRoute = {
      ...apiRoute,
      surface: "LOCAL",
      provider_kind: "OLLAMA",
      provider_category: "LOCAL_MODEL",
      provider_base_url: "http://ollama.internal:11434/v1",
      account_id: null,
      account_health: null,
      account_enabled: null,
      credential_ref: null,
      secret_purpose: null,
      remote_model_id: "qwen3:8b",
    };
    const allowed = new PostgresModelRouteResolver(poolWith(localRoute), {
      allowedLocalOrigins: ["http://ollama.internal:11434"],
    });
    await expect(allowed.resolve(routeId)).resolves.toMatchObject({
      providerKind: "OLLAMA",
      providerModel: "ollama/qwen3:8b",
      apiBase: "http://ollama.internal:11434/v1",
    });

    const rejected = new PostgresModelRouteResolver(poolWith(localRoute), {
      allowedLocalOrigins: ["http://lmstudio.internal:1234"],
    });
    await expect(rejected.resolve(routeId)).rejects.toMatchObject({
      code: "LOCAL_ENDPOINT_DENIED",
    });
  });

  it("rejects provider/surface/category mismatches", async () => {
    await expect(
      new PostgresModelRouteResolver(
        poolWith({ ...apiRoute, surface: "LOCAL", provider_category: "LLM_API" }),
      ).resolve(routeId),
    ).rejects.toMatchObject({ code: "INELIGIBLE_ROUTE" });
  });
});
