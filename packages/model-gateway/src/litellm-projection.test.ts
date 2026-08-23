import { describe, expect, it, vi } from "vitest";
import { LiteLlmProjectionReconciler } from "./litellm-projection.js";

const projection = {
  modelRouteId: "model_route_22222222-2222-2222-2222-222222222222",
  modelAlias: "route-model_route_22222222-2222-2222-2222-222222222222",
  providerModel: "openai/gpt-5-mini",
  apiBase: "https://api.openai.com/v1",
  credential: "provider-super-secret",
};

describe("LiteLlmProjectionReconciler", () => {
  it("patches the deterministic route projection without exposing provider identity publicly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const reconciler = new LiteLlmProjectionReconciler({
      baseUrl: "http://litellm:4000",
      credentialProvider: async () => "gateway-master-key",
      fetch: fetchMock,
    });
    await expect(reconciler.reconcile(projection)).resolves.toEqual({ outcome: "UPDATED" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "http://litellm:4000/model/model_route_22222222-2222-2222-2222-222222222222/update",
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      model_name: projection.modelAlias,
      litellm_params: {
        model: projection.providerModel,
        api_base: projection.apiBase,
        api_key: projection.credential,
      },
      model_info: { id: projection.modelRouteId },
    });
  });

  it("projects the canonical OpenRouter origin, namespaced model and credential", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const reconciler = new LiteLlmProjectionReconciler({
      baseUrl: "http://litellm:4000",
      credentialProvider: async () => "gateway-master-key",
      fetch: fetchMock,
    });
    const openRouterProjection = {
      ...projection,
      providerModel: "openrouter/anthropic/test-model",
      apiBase: "https://openrouter.ai/api/v1",
      credential: "test-openrouter-key",
    };

    await expect(reconciler.reconcile(openRouterProjection)).resolves.toEqual({
      outcome: "UPDATED",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.litellm_params).toEqual({
      model: "openrouter/anthropic/test-model",
      api_base: "https://openrouter.ai/api/v1",
      api_key: "test-openrouter-key",
    });
  });

  it("creates the same deterministic projection when absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const reconciler = new LiteLlmProjectionReconciler({
      baseUrl: "http://litellm:4000",
      credentialProvider: async () => "gateway-master-key",
      fetch: fetchMock,
    });
    await expect(reconciler.reconcile(projection)).resolves.toEqual({ outcome: "CREATED" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://litellm:4000/model/new");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("fails safely without including gateway or provider credentials", async () => {
    const reconciler = new LiteLlmProjectionReconciler({
      baseUrl: "http://litellm:4000",
      credentialProvider: async () => "gateway-master-key",
      fetch: vi.fn<typeof fetch>(
        async () => new Response("provider-super-secret", { status: 503 }),
      ),
    });
    const failure = await reconciler.reconcile(projection).catch((error: unknown) => error);
    expect(String(failure)).not.toContain("provider-super-secret");
    expect(String(failure)).not.toContain("gateway-master-key");
  });
});
