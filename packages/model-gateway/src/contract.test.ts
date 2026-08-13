import { describe, expect, it } from "vitest";
import {
  ModelGatewayFailure,
  ModelGatewayRequestSchema,
  ModelGatewayResultSchema,
  parseModelGatewayRequest,
} from "./index.js";

const request = {
  schemaVersion: 1,
  runId: "run_11111111-1111-1111-1111-111111111111",
  modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
  messages: [{ role: "USER", content: "Answer briefly." }],
  maxOutputTokens: 512,
  temperature: 0,
  timeoutMs: 30_000,
  idempotencyKey: "run-11111111-attempt-1",
};

describe("ModelGateway contract", () => {
  it("accepts one strict adapter-neutral route request", () => {
    expect(ModelGatewayRequestSchema.parse(request)).toEqual(request);
    expect(() => parseModelGatewayRequest({ ...request, provider: "openai" })).toThrow();
    expect(() => parseModelGatewayRequest({ ...request, apiKey: "secret" })).toThrow();
  });

  it("bounds request content, token limits and timeout", () => {
    expect(() => parseModelGatewayRequest({ ...request, messages: [] })).toThrow();
    expect(() =>
      parseModelGatewayRequest({
        ...request,
        messages: [{ role: "USER", content: "x".repeat(1_000_001) }],
      }),
    ).toThrow();
    expect(() => parseModelGatewayRequest({ ...request, maxOutputTokens: 0 })).toThrow();
    expect(() => parseModelGatewayRequest({ ...request, timeoutMs: 600_001 })).toThrow();
  });

  it("keeps tool declarations and calls typed and bounded", () => {
    const withTool = parseModelGatewayRequest({
      ...request,
      tools: [
        {
          toolId: "tool_33333333-3333-3333-3333-333333333333",
          name: "lookup_weather",
          description: "Read a forecast.",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    });
    expect(withTool.tools?.[0]?.name).toBe("lookup_weather");

    const result = ModelGatewayResultSchema.parse({
      schemaVersion: 1,
      runId: request.runId,
      modelRouteId: request.modelRouteId,
      upstreamRequestId: "chatcmpl-safe-id",
      finishReason: "TOOL_CALLS",
      content: "",
      toolCalls: [
        {
          callId: "call_1",
          name: "lookup_weather",
          arguments: { city: "Moscow" },
        },
      ],
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    });
    expect(result.toolCalls[0]?.arguments).toEqual({ city: "Moscow" });
  });

  it("rejects inconsistent usage provenance", () => {
    expect(() =>
      ModelGatewayResultSchema.parse({
        schemaVersion: 1,
        runId: request.runId,
        modelRouteId: request.modelRouteId,
        finishReason: "STOP",
        content: "ok",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 99 },
      }),
    ).toThrow();
    expect(() =>
      ModelGatewayResultSchema.parse({
        schemaVersion: 1,
        runId: request.runId,
        modelRouteId: request.modelRouteId,
        finishReason: "STOP",
        content: "ok",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 11 },
      }),
    ).toThrow();
  });

  it("exposes only a safe typed failure surface", () => {
    const failure = new ModelGatewayFailure("UPSTREAM_AUTH", "Model provider rejected credentials");
    expect(failure).toMatchObject({
      name: "ModelGatewayFailure",
      code: "UPSTREAM_AUTH",
      message: "Model provider rejected credentials",
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain("apiKey");
  });
});
