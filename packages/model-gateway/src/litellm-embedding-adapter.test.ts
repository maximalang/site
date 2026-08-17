import { ModelRouteIdSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { LiteLlmEmbeddingGateway } from "./litellm-embedding-adapter.js";

const routeId = ModelRouteIdSchema.parse("model_route_11111111-1111-1111-1111-111111111111");
const vector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));

function gateway(fetchImplementation: typeof fetch) {
  return new LiteLlmEmbeddingGateway({
    baseUrl: "http://litellm:4000",
    credentialProvider: async () => "test-master-key-value",
    routeResolver: async () => ({ modelRouteId: routeId, modelAlias: "rag-embedding-v1" }),
    fetch: fetchImplementation,
  });
}

describe("LiteLLM embedding adapter", () => {
  it("sends a bounded OpenAI-compatible embedding batch and restores input order", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "rag-embedding-v1",
        data: [
          { object: "embedding", index: 1, embedding: vector },
          { object: "embedding", index: 0, embedding: vector },
        ],
        usage: { prompt_tokens: 8, total_tokens: 8 },
      }),
    );
    const result = await gateway(fetcher).embed({
      modelRouteId: routeId,
      texts: ["first", "second"],
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ model: "rag-embedding-v1", vectors: [vector, vector] });
    expect(fetcher).toHaveBeenCalledWith(
      "http://litellm:4000/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "rag-embedding-v1",
      input: ["first", "second"],
      encoding_format: "float",
    });
  });

  it("fails closed on wrong vector dimensions or duplicate indexes", async () => {
    for (const data of [
      [{ object: "embedding", index: 0, embedding: [1, 2] }],
      [
        { object: "embedding", index: 0, embedding: vector },
        { object: "embedding", index: 0, embedding: vector },
      ],
    ]) {
      const adapter = gateway(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data })));
      await expect(
        adapter.embed({ modelRouteId: routeId, texts: ["first"], timeoutMs: 10_000 }),
      ).rejects.toMatchObject({ code: "INVALID_UPSTREAM_RESPONSE" });
    }
  });

  it("rejects an invalid request before credentials or network", async () => {
    const credentialProvider = vi.fn(async () => "test-master-key-value");
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new LiteLlmEmbeddingGateway({
      baseUrl: "http://litellm:4000",
      credentialProvider,
      routeResolver: async () => ({ modelRouteId: routeId, modelAlias: "rag-embedding-v1" }),
      fetch: fetcher,
    });
    await expect(
      adapter.embed({ modelRouteId: routeId, texts: [], timeoutMs: 10_000 }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(credentialProvider).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
