import { describe, expect, it } from "vitest";
import {
  ExecutionPreferenceLayerSchema,
  ExecutionRouteCandidateSchema,
  eligibleExecutionRoutes,
  resolveExecutionPreferences,
} from "./execution-preferences.js";

const rawLayers = [
  {
    schemaVersion: 1,
    scope: { kind: "SYSTEM" },
    overrides: {
      model: { kind: "AUTO" },
      account: { kind: "AUTO" },
      mode: "AUTO",
      context: "AUTO",
      budget: "BALANCED",
    },
  },
  {
    schemaVersion: 1,
    scope: { kind: "PROJECT", projectId: "project_11111111-1111-1111-1111-111111111111" },
    overrides: { context: "LEAN", budget: "ECONOMY" },
  },
  {
    schemaVersion: 1,
    scope: { kind: "AGENT", agentId: "agent_22222222-2222-2222-2222-222222222222" },
    overrides: {
      model: { kind: "MODEL", modelId: "model_33333333-3333-3333-3333-333333333333" },
      mode: "CODEX",
    },
  },
  {
    schemaVersion: 1,
    scope: { kind: "TASK", taskId: "task_44444444-4444-4444-4444-444444444444" },
    overrides: { budget: "QUALITY" },
  },
] as const;
const layers = rawLayers.map((layer) => ExecutionPreferenceLayerSchema.parse(layer));
const [systemLayer, projectLayer, agentLayer, taskLayer] = layers;
if (!systemLayer || !projectLayer || !agentLayer || !taskLayer) throw new Error("Invalid fixtures");

describe("resolveExecutionPreferences", () => {
  it("resolves each field from the most specific sparse override", () => {
    const resolved = resolveExecutionPreferences(layers);
    expect(resolved).toEqual({
      schemaVersion: 1,
      model: {
        value: { kind: "MODEL", modelId: "model_33333333-3333-3333-3333-333333333333" },
        source: agentLayer.scope,
      },
      account: { value: { kind: "AUTO" }, source: systemLayer.scope },
      mode: { value: "CODEX", source: agentLayer.scope },
      context: { value: "LEAN", source: projectLayer.scope },
      budget: { value: "QUALITY", source: taskLayer.scope },
    });
  });

  it("reset is deletion of the local field, revealing the inherited winner", () => {
    const withLocal = layers.map((layer) => ExecutionPreferenceLayerSchema.parse(layer));
    withLocal[2] = ExecutionPreferenceLayerSchema.parse({
      ...withLocal[2],
      overrides: { ...withLocal[2]?.overrides, context: "RICH" },
    });
    expect(resolveExecutionPreferences(withLocal).context.source.kind).toBe("AGENT");

    const { context: _removed, ...remaining } = withLocal[2]?.overrides ?? {};
    withLocal[2] = ExecutionPreferenceLayerSchema.parse({ ...withLocal[2], overrides: remaining });
    expect(resolveExecutionPreferences(withLocal).context).toEqual({
      value: "LEAN",
      source: projectLayer.scope,
    });
  });

  it("rejects duplicate, out-of-order, incomplete System and crossed identities", () => {
    expect(() => resolveExecutionPreferences([projectLayer, systemLayer])).toThrow();
    expect(() => resolveExecutionPreferences([systemLayer, projectLayer, projectLayer])).toThrow();
    expect(() =>
      resolveExecutionPreferences([{ ...systemLayer, overrides: { model: { kind: "AUTO" } } }]),
    ).toThrow();
    expect(
      ExecutionPreferenceLayerSchema.safeParse({
        ...agentLayer,
        scope: { kind: "AGENT", agentId: "account_22222222-2222-2222-2222-222222222222" },
      }).success,
    ).toBe(false);
  });
});

describe("eligibleExecutionRoutes", () => {
  const system = resolveExecutionPreferences([
    ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "SYSTEM" },
      overrides: {
        model: { kind: "AUTO" },
        account: { kind: "AUTO" },
        mode: "AUTO",
        context: "BALANCED",
        budget: "BALANCED",
      },
    }),
  ]);
  const base = {
    modelId: "model_11111111-1111-1111-1111-111111111111",
    providerId: "provider_22222222-2222-2222-2222-222222222222",
    accountId: "account_33333333-3333-3333-3333-333333333333",
    mode: "API" as const,
    availability: "AVAILABLE" as const,
    providerEnabled: true,
    modelEnabled: true,
    routeEnabled: true,
    accountEnabled: true,
    accountHealth: "ACTIVE" as const,
  };

  it("excludes every disabled or unavailable dependency before deterministic fallback", () => {
    const eligible = ExecutionRouteCandidateSchema.parse({
      ...base,
      modelRouteId: "model_route_11111111-1111-1111-1111-111111111111",
    });
    const fallback = ExecutionRouteCandidateSchema.parse({
      ...base,
      modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
      availability: "DEGRADED" as const,
      accountHealth: "DEGRADED" as const,
    });
    const blocked = [
      {
        ...base,
        modelRouteId: "model_route_33333333-3333-3333-3333-333333333333",
        routeEnabled: false,
      },
      {
        ...base,
        modelRouteId: "model_route_44444444-4444-4444-4444-444444444444",
        modelEnabled: false,
      },
      {
        ...base,
        modelRouteId: "model_route_55555555-5555-5555-5555-555555555555",
        providerEnabled: false,
      },
      {
        ...base,
        modelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
        accountEnabled: false,
      },
      {
        ...base,
        modelRouteId: "model_route_77777777-7777-7777-7777-777777777777",
        availability: "UNKNOWN" as const,
      },
      {
        ...base,
        modelRouteId: "model_route_88888888-8888-8888-8888-888888888888",
        accountHealth: "EXHAUSTED" as const,
      },
    ].map((candidate) => ExecutionRouteCandidateSchema.parse(candidate));
    expect(eligibleExecutionRoutes(system, [fallback, ...blocked, eligible])).toEqual([
      eligible,
      fallback,
    ]);
  });

  it("applies explicit model, account and mode constraints without Agent ownership", () => {
    const selected = resolveExecutionPreferences([
      ExecutionPreferenceLayerSchema.parse({
        schemaVersion: 1,
        scope: { kind: "SYSTEM" },
        overrides: {
          model: { kind: "MODEL", modelId: base.modelId },
          account: { kind: "ACCOUNT", accountId: base.accountId },
          mode: "API",
          context: "BALANCED",
          budget: "BALANCED",
        },
      }),
    ]);
    const candidate = ExecutionRouteCandidateSchema.parse({
      ...base,
      modelRouteId: "model_route_99999999-9999-9999-9999-999999999999",
    });
    expect(eligibleExecutionRoutes(selected, [candidate])).toEqual([candidate]);
    expect(
      eligibleExecutionRoutes(selected, [
        ExecutionRouteCandidateSchema.parse({
          ...candidate,
          accountId: "account_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        }),
      ]),
    ).toEqual([]);
  });
});
