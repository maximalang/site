import { ModelRouteIdSchema, OpaqueExternalIdSchema } from "@agent-world/domain";
import * as z from "zod";
import {
  type EmbeddingGateway,
  type EmbeddingGatewayRequest,
  EmbeddingGatewayRequestSchema,
  type EmbeddingGatewayResult,
  EmbeddingGatewayResultSchema,
  ModelGatewayFailure,
} from "./contract.js";

const MAX_RESPONSE_BYTES = 32_000_000;
const CredentialSchema = z.string().trim().min(1).max(4_096);
const ResolvedRouteSchema = z.strictObject({
  modelRouteId: ModelRouteIdSchema,
  modelAlias: OpaqueExternalIdSchema,
});
const UpstreamEmbeddingSchema = z.strictObject({
  object: z.literal("embedding"),
  index: z.number().int().nonnegative().max(255),
  embedding: z.array(z.number().finite()).length(1536),
});
const UpstreamResponseSchema = z.object({
  data: z.array(UpstreamEmbeddingSchema).min(1).max(256),
});

export type LiteLlmEmbeddingGatewayOptions = {
  baseUrl: string;
  credentialProvider: () => Promise<string>;
  routeResolver: (modelRouteId: EmbeddingGatewayRequest["modelRouteId"]) => Promise<{
    modelRouteId: string;
    modelAlias: string;
  }>;
  fetch?: typeof fetch;
};

function origin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("LiteLLM base URL must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new TypeError("LiteLLM base URL must be a credential-free HTTP(S) origin");
  }
  return url.origin;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ModelGatewayFailure("INVALID_UPSTREAM_RESPONSE", "Embedding response is too large");
  }
  if (!response.body) {
    throw new ModelGatewayFailure("INVALID_UPSTREAM_RESPONSE", "Embedding response is empty");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ModelGatewayFailure(
          "INVALID_UPSTREAM_RESPONSE",
          "Embedding response is too large",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ModelGatewayFailure("INVALID_UPSTREAM_RESPONSE", "Embedding response is invalid");
  }
}

function statusFailure(status: number): ModelGatewayFailure {
  if (status === 401 || status === 403)
    return new ModelGatewayFailure("UPSTREAM_AUTH", "Embedding gateway rejected credentials");
  if (status === 429)
    return new ModelGatewayFailure("RATE_LIMITED", "Embedding gateway rate limit reached");
  if (status === 400 || status === 404 || status === 422)
    return new ModelGatewayFailure("INVALID_REQUEST", "Embedding gateway rejected the request");
  return new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Embedding gateway is unavailable");
}

export class LiteLlmEmbeddingGateway implements EmbeddingGateway {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: LiteLlmEmbeddingGatewayOptions) {
    this.baseUrl = origin(options.baseUrl);
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async embed(value: EmbeddingGatewayRequest): Promise<EmbeddingGatewayResult> {
    let input: EmbeddingGatewayRequest;
    try {
      input = EmbeddingGatewayRequestSchema.parse(value);
    } catch {
      throw new ModelGatewayFailure("INVALID_REQUEST", "Embedding request is invalid");
    }
    const route = ResolvedRouteSchema.parse(await this.options.routeResolver(input.modelRouteId));
    if (route.modelRouteId !== input.modelRouteId) {
      throw new ModelGatewayFailure("ROUTE_UNAVAILABLE", "Embedding route resolution mismatch");
    }
    const credential = CredentialSchema.parse(await this.options.credentialProvider());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: route.modelAlias,
          input: input.texts,
          encoding_format: "float",
        }),
        signal: controller.signal,
      });
    } catch {
      throw new ModelGatewayFailure(
        controller.signal.aborted ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        controller.signal.aborted
          ? "Embedding request timed out"
          : "Embedding gateway is unavailable",
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw statusFailure(response.status);
    const parsed = UpstreamResponseSchema.safeParse(await boundedJson(response));
    if (!parsed.success || parsed.data.data.length !== input.texts.length) {
      throw new ModelGatewayFailure(
        "INVALID_UPSTREAM_RESPONSE",
        "Embedding gateway returned invalid vectors",
      );
    }
    const vectors: number[][] = Array.from({ length: input.texts.length });
    for (const item of parsed.data.data) {
      if (item.index >= vectors.length || vectors[item.index] !== undefined) {
        throw new ModelGatewayFailure(
          "INVALID_UPSTREAM_RESPONSE",
          "Embedding gateway returned invalid indexes",
        );
      }
      vectors[item.index] = item.embedding;
    }
    try {
      return EmbeddingGatewayResultSchema.parse({ model: route.modelAlias, vectors });
    } catch {
      throw new ModelGatewayFailure(
        "INVALID_UPSTREAM_RESPONSE",
        "Embedding gateway returned invalid vectors",
      );
    }
  }
}
