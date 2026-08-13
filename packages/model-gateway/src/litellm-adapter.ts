import { ModelRouteIdSchema, OpaqueExternalIdSchema } from "@agent-world/domain";
import * as z from "zod";
import {
  type ModelGateway,
  ModelGatewayFailure,
  type ModelGatewayHealth,
  ModelGatewayHealthSchema,
  type ModelGatewayRequest,
  ModelGatewayRequestSchema,
  type ModelGatewayResult,
  ModelGatewayResultSchema,
  type ModelGatewayToolCall,
  ModelGatewayToolCallSchema,
} from "./contract.js";

const MAX_UPSTREAM_RESPONSE_BYTES = 2_000_000;
const LiteLlmCredentialSchema = z.string().trim().min(1).max(4_096);
const ResolvedRouteSchema = z.strictObject({
  modelRouteId: ModelRouteIdSchema,
  modelAlias: OpaqueExternalIdSchema,
});
const UpstreamToolCallSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(64),
    arguments: z.string().max(65_536),
  }),
});
const UpstreamCompletionSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().max(1_000_000).nullable(),
          tool_calls: z.array(UpstreamToolCallSchema).max(64).optional(),
        }),
      }),
    )
    .length(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .optional(),
  }),
});

type ResolvedLiteLlmRoute = z.infer<typeof ResolvedRouteSchema>;

export type LiteLlmModelGatewayOptions = {
  baseUrl: string;
  credentialProvider: () => Promise<string>;
  routeResolver: (
    modelRouteId: ModelGatewayRequest["modelRouteId"],
  ) => Promise<ResolvedLiteLlmRoute>;
  fetch?: typeof fetch;
  now?: () => Date;
};

function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("LiteLLM base URL must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new TypeError(
      "LiteLLM base URL must be an HTTP(S) origin without credentials or parameters",
    );
  }
  return url.origin;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds <= 86_400_000
    ? milliseconds
    : undefined;
}

function statusFailure(response: Response): ModelGatewayFailure {
  if (response.status === 401 || response.status === 403) {
    return new ModelGatewayFailure("UPSTREAM_AUTH", "Model gateway rejected credentials");
  }
  if (response.status === 429) {
    return new ModelGatewayFailure(
      "RATE_LIMITED",
      "Model gateway rate limit reached",
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  if (response.status === 408 || response.status === 504) {
    return new ModelGatewayFailure("TIMEOUT", "Model gateway request timed out");
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return new ModelGatewayFailure("INVALID_REQUEST", "Model gateway rejected the request");
  }
  return new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model gateway is unavailable");
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Model gateway response is too large",
    );
  }
  if (response.body === null) {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Model gateway returned an empty response",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_UPSTREAM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ModelGatewayFailure(
          "INVALID_UPSTREAM_RESPONSE",
          "Model gateway response is too large",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Model gateway returned invalid JSON",
    );
  }
}

function normalizeToolCall(value: z.infer<typeof UpstreamToolCallSchema>): ModelGatewayToolCall {
  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(value.function.arguments);
  } catch {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Model gateway returned invalid tool arguments",
    );
  }
  try {
    return ModelGatewayToolCallSchema.parse({
      callId: value.id,
      name: value.function.name,
      arguments: parsedArguments,
    });
  } catch {
    throw new ModelGatewayFailure(
      "INVALID_UPSTREAM_RESPONSE",
      "Model gateway returned invalid tool arguments",
    );
  }
}

function mapFinishReason(
  value: z.infer<typeof UpstreamCompletionSchema>["choices"][0]["finish_reason"],
) {
  return {
    stop: "STOP",
    length: "LENGTH",
    tool_calls: "TOOL_CALLS",
    content_filter: "CONTENT_FILTER",
  }[value] as "STOP" | "LENGTH" | "TOOL_CALLS" | "CONTENT_FILTER";
}

export class LiteLlmModelGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly credentialProvider: () => Promise<string>;
  private readonly routeResolver: LiteLlmModelGatewayOptions["routeResolver"];
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(options: LiteLlmModelGatewayOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    this.credentialProvider = options.credentialProvider;
    this.routeResolver = options.routeResolver;
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async complete(
    requestValue: ModelGatewayRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ModelGatewayResult> {
    let request: ModelGatewayRequest;
    try {
      request = ModelGatewayRequestSchema.parse(requestValue);
    } catch {
      throw new ModelGatewayFailure("INVALID_REQUEST", "Model gateway request is invalid");
    }
    const route = ResolvedRouteSchema.parse(await this.routeResolver(request.modelRouteId));
    if (route.modelRouteId !== request.modelRouteId) {
      throw new ModelGatewayFailure("ROUTE_UNAVAILABLE", "Model route resolution mismatch");
    }
    const credential = LiteLlmCredentialSchema.parse(await this.credentialProvider());
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), request.timeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-request-id": request.idempotencyKey,
        },
        body: JSON.stringify({
          model: route.modelAlias,
          messages: request.messages.map((message) => ({
            role: message.role.toLowerCase(),
            content: message.content,
            ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
          })),
          ...(request.tools === undefined
            ? {}
            : {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
                tool_choice: "auto",
              }),
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          stream: false,
        }),
        signal,
      });
    } catch {
      if (options?.signal?.aborted) {
        throw new ModelGatewayFailure("CANCELLED", "Model gateway request was cancelled");
      }
      if (timeoutController.signal.aborted) {
        throw new ModelGatewayFailure("TIMEOUT", "Model gateway request timed out");
      }
      throw new ModelGatewayFailure("UPSTREAM_UNAVAILABLE", "Model gateway is unavailable");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw statusFailure(response);

    let upstream: z.infer<typeof UpstreamCompletionSchema>;
    try {
      upstream = UpstreamCompletionSchema.parse(await readBoundedJson(response));
    } catch (error) {
      if (error instanceof ModelGatewayFailure) throw error;
      throw new ModelGatewayFailure(
        "INVALID_UPSTREAM_RESPONSE",
        "Model gateway response is invalid",
      );
    }
    const choice = upstream.choices[0];
    if (choice === undefined) {
      throw new ModelGatewayFailure(
        "INVALID_UPSTREAM_RESPONSE",
        "Model gateway response has no choice",
      );
    }
    const toolCalls = (choice.message.tool_calls ?? []).map(normalizeToolCall);
    try {
      return ModelGatewayResultSchema.parse({
        schemaVersion: 1,
        runId: request.runId,
        modelRouteId: request.modelRouteId,
        ...(upstream.id === undefined ? {} : { upstreamRequestId: upstream.id }),
        finishReason: mapFinishReason(choice.finish_reason),
        content: choice.message.content ?? "",
        toolCalls,
        usage: {
          inputTokens: upstream.usage.prompt_tokens,
          outputTokens: upstream.usage.completion_tokens,
          totalTokens: upstream.usage.total_tokens,
          ...(upstream.usage.prompt_tokens_details === undefined
            ? {}
            : { cachedInputTokens: upstream.usage.prompt_tokens_details.cached_tokens }),
          ...(upstream.usage.completion_tokens_details === undefined
            ? {}
            : { reasoningOutputTokens: upstream.usage.completion_tokens_details.reasoning_tokens }),
        },
      });
    } catch {
      throw new ModelGatewayFailure(
        "INVALID_UPSTREAM_RESPONSE",
        "Model gateway response is invalid",
      );
    }
  }

  async health(options?: { signal?: AbortSignal }): Promise<ModelGatewayHealth> {
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/health/readiness`, {
        method: "GET",
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      return ModelGatewayHealthSchema.parse({
        schemaVersion: 1,
        status: response.ok ? "READY" : "DEGRADED",
        checkedAt: this.now().toISOString(),
      });
    } catch {
      return ModelGatewayHealthSchema.parse({
        schemaVersion: 1,
        status: "UNAVAILABLE",
        checkedAt: this.now().toISOString(),
      });
    }
  }
}
