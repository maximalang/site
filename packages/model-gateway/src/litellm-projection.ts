import * as z from "zod";
import { ModelGatewayFailure } from "./contract.js";

const ProjectionSchema = z.strictObject({
  modelRouteId: z.string().regex(/^model_route_[0-9a-f-]{36}$/),
  modelAlias: z.string().min(1).max(512),
  providerModel: z.string().min(1).max(512),
  apiBase: z.url().max(2_048).optional(),
  credential: z.string().min(1).max(16_384).optional(),
});
export type LiteLlmRouteProjection = z.infer<typeof ProjectionSchema>;

export class LiteLlmProjectionReconciler {
  private readonly baseUrl: string;
  private readonly credentialProvider: () => Promise<string>;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: {
    baseUrl: string;
    credentialProvider: () => Promise<string>;
    fetch?: typeof fetch;
  }) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/"
    ) {
      throw new TypeError("LiteLLM projection URL must be a credential-free HTTP(S) origin");
    }
    this.baseUrl = url.origin;
    this.credentialProvider = options.credentialProvider;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async reconcile(value: LiteLlmRouteProjection): Promise<{ outcome: "CREATED" | "UPDATED" }> {
    const projection = ProjectionSchema.parse(value);
    const gatewayCredential = await this.credentialProvider();
    const body = JSON.stringify({
      model_name: projection.modelAlias,
      litellm_params: {
        model: projection.providerModel,
        ...(projection.apiBase === undefined ? {} : { api_base: projection.apiBase }),
        ...(projection.credential === undefined ? {} : { api_key: projection.credential }),
      },
      model_info: { id: projection.modelRouteId },
    });
    const headers = {
      authorization: `Bearer ${gatewayCredential}`,
      "content-type": "application/json",
    };
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.baseUrl}/model/${projection.modelRouteId}/update`,
        { method: "PATCH", headers, body },
      );
    } catch {
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model projection gateway unavailable");
    }
    if (response.ok) {
      await response.body?.cancel();
      return { outcome: "UPDATED" };
    }
    if (response.status !== 404) {
      await response.body?.cancel();
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model projection update failed");
    }
    await response.body?.cancel();
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/model/new`, {
        method: "POST",
        headers,
        body,
      });
    } catch {
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model projection gateway unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model projection create failed");
    }
    await response.body?.cancel();
    return { outcome: "CREATED" };
  }
}
