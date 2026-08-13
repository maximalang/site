import { describe, expect, it } from "vitest";
import {
  ExecutionPreferenceLayerSchema,
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
