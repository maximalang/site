import { describe, expect, it, vi } from "vitest";
import { LiteLlmModelGateway, ModelGatewayFailure } from "./index.js";

const gatewayRequest = {
  schemaVersion: 1 as const,
  runId: "run_11111111-1111-1111-1111-111111111111" as const,
  modelRouteId: "model_route_22222222-2222-2222-2222-222222222222" as const,
  messages: [{ role: "USER" as const, content: "hello" }],
  maxOutputTokens: 64,
  temperature: 0,
  timeoutMs: 30_000,
  idempotencyKey: "run-1-attempt-1",
};

function createGateway(fetchImplementation: typeof fetch) {
  return new LiteLlmModelGateway({
    baseUrl: "http://litellm:4000",
    credentialProvider: async () => "gateway-master-key",
    routeResolver: async (routeId) => ({
      modelRouteId: routeId,
      modelAlias: "route-model_route_22222222",
    }),
    fetch: fetchImplementation,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });
}

describe("LiteLlmModelGateway", () => {
  it("maps the neutral contract to one authenticated chat completion", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (_input, _init) =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-safe-id",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "hello back" },
              },
            ],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 3,
              total_tokens: 7,
              prompt_tokens_details: { cached_tokens: 2 },
              completion_tokens_details: { reasoning_tokens: 1 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const gateway = createGateway(fetchMock);

    await expect(gateway.complete(gatewayRequest)).resolves.toMatchObject({
      runId: gatewayRequest.runId,
      modelRouteId: gatewayRequest.modelRouteId,
      finishReason: "STOP",
      content: "hello back",
      usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
        cachedInputTokens: 2,
        reasoningOutputTokens: 1,
      },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://litellm:4000/chat/completions");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer gateway-master-key",
      "content-type": "application/json",
      "x-request-id": gatewayRequest.idempotencyKey,
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "route-model_route_22222222",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 64,
      temperature: 0,
      stream: false,
    });
  });

  it("normalizes status failures without reading or leaking the response body", async () => {
    const secretBody = "provider said key=super-secret";
    const gateway = createGateway(
      vi.fn<typeof fetch>(async () => new Response(secretBody, { status: 401 })),
    );

    const failure = await gateway.complete(gatewayRequest).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ModelGatewayFailure);
    expect(failure).toMatchObject({ code: "UPSTREAM_AUTH", retryable: false });
    expect(String(failure)).not.toContain(secretBody);
    expect(String(failure)).not.toContain("gateway-master-key");
  });

  it("rejects malformed upstream tool arguments", async () => {
    const gateway = createGateway(
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              id: "chatcmpl-safe-id",
              choices: [
                {
                  index: 0,
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: { name: "lookup", arguments: "{" },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(gateway.complete(gatewayRequest)).rejects.toMatchObject({
      code: "INVALID_UPSTREAM_RESPONSE",
    });
  });

  it("uses readiness, not provider inference, for gateway health", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok", { status: 200 }));
    const gateway = createGateway(fetchMock);

    await expect(gateway.health()).resolves.toEqual({
      schemaVersion: 1,
      status: "READY",
      checkedAt: "2026-08-13T12:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://litellm:4000/health/readiness");
  });

  it("rejects base URLs that carry credentials or mutable URL parts", () => {
    expect(
      () =>
        new LiteLlmModelGateway({
          baseUrl: "http://user:secret@litellm:4000?key=secret",
          credentialProvider: async () => "key",
          routeResolver: async (modelRouteId) => ({ modelRouteId, modelAlias: "model" }),
        }),
    ).toThrow("LiteLLM base URL");
  });
});
