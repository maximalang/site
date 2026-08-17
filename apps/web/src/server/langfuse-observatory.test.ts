import { OperationsReadModelSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import {
  LangfuseObservatorySupervisor,
  LangfuseOtlpExporter,
  parseLangfuseTelemetryConfig,
} from "./langfuse-observatory";

const snapshot = OperationsReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-17T12:00:00.000Z",
  actionGraph: {
    nodes: [
      {
        kind: "RUN",
        id: "run_11111111-1111-1111-1111-111111111111",
        label: "secret task label must stay canonical-only",
        taskId: "task_11111111-1111-1111-1111-111111111111",
        agentId: "agent_11111111-1111-1111-1111-111111111111",
        status: "COMPLETED",
        adapterKind: "API_MODEL",
        occurredAt: "2026-08-17T11:59:00.000Z",
        resultSummary: "SECRET_OUTPUT_DO_NOT_EXPORT",
      },
    ],
    edges: [],
  },
  observatory: {
    runs: { total: 7, completed: 5, failed: 1 },
    tokens: { input: 100, cachedInput: 25, output: 40 },
    context: { estimatedTokens: 400, budgetTokens: 1_000, pressure: 0.4 },
    monetaryCost: {
      status: "ESTIMATED",
      amountUsd: 1.25,
      source: "LITELLM_RESPONSE_HEADER",
      jobCount: 3,
    },
    routeSignals: [
      {
        routeId: "route_11111111-1111-1111-1111-111111111111",
        isAvailable: true,
        quality: 0.9,
        remainingLimits: 0.8,
        costEfficiency: 0.7,
        speed: 0.6,
        loadHeadroom: 0.5,
        observedAt: "2026-08-17T11:59:00.000Z",
        expiresAt: "2026-08-17T12:01:00.000Z",
        isFresh: true,
      },
    ],
  },
});

describe("Langfuse Observatory projection", () => {
  it("stays disabled until all credentials are explicitly configured", () => {
    expect(parseLangfuseTelemetryConfig({})).toBeUndefined();
    expect(() =>
      parseLangfuseTelemetryConfig({ AGENT_WORLD_LANGFUSE_BASE_URL: "https://langfuse.example" }),
    ).toThrow("incomplete");
  });

  it("rejects unsafe plaintext or ambiguous Basic-auth configuration", () => {
    expect(() =>
      parseLangfuseTelemetryConfig({
        AGENT_WORLD_LANGFUSE_BASE_URL: "http://langfuse.example",
        AGENT_WORLD_LANGFUSE_PUBLIC_KEY: "pk-lf-test",
        AGENT_WORLD_LANGFUSE_SECRET_KEY: "sk-lf-test",
      }),
    ).toThrow("requires HTTPS");
    expect(() =>
      parseLangfuseTelemetryConfig({
        AGENT_WORLD_LANGFUSE_BASE_URL: "https://langfuse.example",
        AGENT_WORLD_LANGFUSE_PUBLIC_KEY: "pk-lf:test",
        AGENT_WORLD_LANGFUSE_SECRET_KEY: "sk-lf-test",
      }),
    ).toThrow("Basic-auth contract");
  });

  it("exports only scrubbed Observatory aggregates to the pinned OTLP endpoint", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const config = parseLangfuseTelemetryConfig({
      AGENT_WORLD_LANGFUSE_BASE_URL: "https://langfuse.example",
      AGENT_WORLD_LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      AGENT_WORLD_LANGFUSE_SECRET_KEY: "sk-lf-test",
    });
    expect(config).toBeDefined();
    if (!config) return;

    await new LangfuseOtlpExporter(config, fakeFetch).export(snapshot);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://langfuse.example/api/public/otel/v1/traces");
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`,
    );
    const body = String(requests[0]?.init.body);
    expect(body).toContain('"resourceSpans"');
    expect(body).toContain('"agent_world.runs.total"');
    expect(body).toContain('"agent_world.tokens.input"');
    expect(body).toContain('"agent_world.monetary_cost.amount_usd"');
    expect(body).not.toContain("SECRET_OUTPUT_DO_NOT_EXPORT");
    expect(body).not.toContain("secret task label must stay canonical-only");
    expect(body).not.toContain("route_11111111-1111-1111-1111-111111111111");
    expect(body).not.toContain("sk-lf-test");
  });

  it("keeps telemetry failures fail-open and reports only a generic failure", async () => {
    const events: unknown[] = [];
    const supervisor = new LangfuseObservatorySupervisor({
      readOperations: async () => snapshot,
      exporter: {
        export: async () => {
          throw new Error("secret upstream detail");
        },
      },
      pollMs: 30_000,
      record: (event) => events.push(event),
    });

    await expect(supervisor.runOnce()).resolves.toBeUndefined();
    expect(events).toEqual([{ event: "projection_failed" }]);
  });
});
