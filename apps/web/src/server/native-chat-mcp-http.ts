import {
  AccountIdSchema,
  AgentIdSchema,
  ArtifactIdSchema,
  NativeChatControlEventInputSchema,
  NativeChatPullRequestSchema,
  RunIdSchema,
  StructuredAgentOutputSchema,
} from "@agent-world/domain";
import * as z from "zod";

const WRITE_SCOPE = "ai_world.run.write";
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const SUPPORTED_PROTOCOLS = new Set(["2025-11-25", "2025-06-18"]);
const ALLOWED_REMOTE_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

type JsonRpcId = string | number | null;
type NativeChatPrincipal = {
  accountId: string;
  scopes: ReadonlySet<string>;
};

export type NativeChatMcpDependencies = {
  resource: string;
  authorize(request: Request): Promise<NativeChatPrincipal | undefined>;
  append(accountId: z.infer<typeof AccountIdSchema>, event: unknown): Promise<unknown>;
  pull(accountId: z.infer<typeof AccountIdSchema>, request: unknown): Promise<unknown>;
};

const JsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(200), z.number().safe(), z.null()]).optional(),
  method: z.string().trim().min(1).max(100),
  params: z.unknown().optional(),
});

const ToolCallSchema = z.strictObject({
  name: z.enum(["begin_run", "get_run_resources", "emit_run_event", "commit_result", "fail_run"]),
  arguments: z.unknown().optional(),
});

const EnvelopeArguments = {
  run_id: RunIdSchema,
  sequence: z.number().int().positive(),
  idempotency_key: z.string().min(3).max(200),
};

const BeginArgumentsSchema = z.strictObject(EnvelopeArguments);
const PullArgumentsSchema = z.strictObject({
  run_id: RunIdSchema,
  resources: z
    .array(
      z.enum(["TASK", "PROJECT_STATE", "MEMORY", "RAG", "SKILLS", "ARTIFACTS", "ACTION_HISTORY"]),
    )
    .min(1)
    .max(7),
  query: z.string().trim().min(1).max(2_000).optional(),
  max_items: z.number().int().min(1).max(100),
  max_tokens: z.number().int().min(64).max(100_000),
});
const EmitArgumentsSchema = z.discriminatedUnion("event_type", [
  z.strictObject({
    ...EnvelopeArguments,
    event_type: z.literal("heartbeat"),
    progress: z.string().trim().min(1).max(2_000),
  }),
  z.strictObject({
    ...EnvelopeArguments,
    event_type: z.literal("finding"),
    statement: z.string().trim().min(1).max(8_000),
    confidence: z.number().min(0).max(1),
  }),
  z.strictObject({
    ...EnvelopeArguments,
    event_type: z.literal("artifact"),
    artifact_id: ArtifactIdSchema,
    note: z.string().trim().min(1).max(2_000).optional(),
  }),
  z.strictObject({
    ...EnvelopeArguments,
    event_type: z.literal("decision"),
    decision: z.string().trim().min(1).max(8_000),
    rationale: z.string().trim().min(1).max(8_000),
  }),
  z.strictObject({
    ...EnvelopeArguments,
    event_type: z.literal("handoff"),
    target_agent_id: AgentIdSchema,
    summary: z.string().trim().min(1).max(20_000),
  }),
]);
const CommitArgumentsSchema = z.strictObject({
  ...EnvelopeArguments,
  structured_result: StructuredAgentOutputSchema,
});
const FailArgumentsSchema = z.strictObject({
  ...EnvelopeArguments,
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  message: z.string().trim().min(1).max(8_000),
  retryable: z.boolean(),
});

const TOOLS = [
  {
    name: "begin_run",
    title: "Attach to an AI World Run",
    description: "Begin one browser-submitted Native Chat Run before reading or emitting work.",
    inputSchema: objectSchema(
      {
        run_id: canonicalIdSchema("run"),
        sequence: integerSchema(1),
        idempotency_key: stringSchema(3, 200),
      },
      ["run_id", "sequence", "idempotency_key"],
    ),
  },
  {
    name: "get_run_resources",
    title: "Pull bounded AI World resources",
    description:
      "After begin_run, lazily pull only the requested Task, project state, skills, history, memory, RAG or artifact resources with provenance and a token budget.",
    inputSchema: objectSchema(
      {
        run_id: canonicalIdSchema("run"),
        resources: {
          type: "array",
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "TASK",
              "PROJECT_STATE",
              "MEMORY",
              "RAG",
              "SKILLS",
              "ARTIFACTS",
              "ACTION_HISTORY",
            ],
          },
        },
        query: stringSchema(1, 2_000),
        max_items: { type: "integer", minimum: 1, maximum: 100 },
        max_tokens: { type: "integer", minimum: 64, maximum: 100_000 },
      },
      ["run_id", "resources", "max_items", "max_tokens"],
    ),
  },
  {
    name: "emit_run_event",
    title: "Emit structured Run progress",
    description:
      "Append one heartbeat, finding, artifact, decision or handoff to canonical history.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: canonicalIdSchema("run"),
        sequence: integerSchema(1),
        idempotency_key: stringSchema(3, 200),
        event_type: {
          type: "string",
          enum: ["heartbeat", "finding", "artifact", "decision", "handoff"],
        },
        progress: stringSchema(1, 2_000),
        statement: stringSchema(1, 8_000),
        confidence: { type: "number", minimum: 0, maximum: 1 },
        artifact_id: canonicalIdSchema("artifact"),
        note: stringSchema(1, 2_000),
        decision: stringSchema(1, 8_000),
        rationale: stringSchema(1, 8_000),
        target_agent_id: canonicalIdSchema("agent"),
        summary: stringSchema(1, 20_000),
      },
      required: ["run_id", "sequence", "idempotency_key", "event_type"],
      additionalProperties: false,
    },
  },
  {
    name: "commit_result",
    title: "Commit the terminal structured result",
    description: "Complete the Run in AI World. Call this before writing the final Chat message.",
    inputSchema: objectSchema(
      {
        run_id: canonicalIdSchema("run"),
        sequence: integerSchema(1),
        idempotency_key: stringSchema(3, 200),
        structured_result: { type: "object", additionalProperties: true },
      },
      ["run_id", "sequence", "idempotency_key", "structured_result"],
    ),
  },
  {
    name: "fail_run",
    title: "Fail a Run with structured evidence",
    description: "Terminally fail a Run when it cannot safely produce a committed result.",
    inputSchema: objectSchema(
      {
        run_id: canonicalIdSchema("run"),
        sequence: integerSchema(1),
        idempotency_key: stringSchema(3, 200),
        failure_code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
        message: stringSchema(1, 8_000),
        retryable: { type: "boolean" },
      },
      ["run_id", "sequence", "idempotency_key", "failure_code", "message", "retryable"],
    ),
  },
].map((tool) => ({
  ...tool,
  securitySchemes: [{ type: "oauth2", scopes: [WRITE_SCOPE] }],
  annotations: {
    readOnlyHint: tool.name === "get_run_resources",
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}));

export function createNativeChatMcpHandlers(dependencies: NativeChatMcpDependencies) {
  const resource = canonicalResource(dependencies.resource);
  const metadataUrl = protectedResourceMetadataUrl(resource);

  return {
    GET: async () =>
      new Response(null, { status: 405, headers: { ...RESPONSE_HEADERS, Allow: "POST, GET" } }),
    POST: async (request: Request): Promise<Response> => {
      if (!isAllowedOrigin(request, resource)) return plainError("ORIGIN_NOT_ALLOWED", 403);
      const principal = await safeAuthorize(dependencies, request);
      if (!principal?.scopes.has(WRITE_SCOPE)) {
        return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), {
          status: 401,
          headers: {
            ...RESPONSE_HEADERS,
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${WRITE_SCOPE}"`,
          },
        });
      }
      if (!acceptsMcpResponse(request) || !supportsProtocol(request)) {
        return plainError("UNSUPPORTED_MCP_REQUEST", 400);
      }

      let rpc: z.infer<typeof JsonRpcRequestSchema>;
      try {
        rpc = JsonRpcRequestSchema.parse(await readJson(request));
      } catch {
        return rpcError(null, -32700, "Parse error", 400);
      }
      const id = rpc.id ?? null;
      if (rpc.id === undefined)
        return new Response(null, { status: 202, headers: RESPONSE_HEADERS });

      if (rpc.method === "initialize") {
        return rpcResult(id, {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ai-world-control", version: "0.1.0" },
        });
      }
      if (rpc.method === "ping") return rpcResult(id, {});
      if (rpc.method === "tools/list") return rpcResult(id, { tools: TOOLS });
      if (rpc.method !== "tools/call") return rpcError(id, -32601, "Method not found");

      let call: z.infer<typeof ToolCallSchema>;
      try {
        call = ToolCallSchema.parse(rpc.params);
      } catch {
        return rpcError(id, -32602, "Invalid params");
      }
      let event: unknown;
      if (call.name === "get_run_resources") {
        try {
          const args = PullArgumentsSchema.parse(call.arguments ?? {});
          const pullRequest = NativeChatPullRequestSchema.parse({
            schemaVersion: 1,
            runId: args.run_id,
            resources: args.resources,
            ...(args.query ? { query: args.query } : {}),
            maxItems: args.max_items,
            maxTokens: args.max_tokens,
          });
          const structuredContent = await dependencies.pull(principal.accountId, pullRequest);
          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(structuredContent) }],
            structuredContent,
          });
        } catch {
          return rpcResult(id, {
            content: [{ type: "text", text: "AI World rejected the resource pull." }],
            isError: true,
          });
        }
      }
      try {
        event = eventFromTool(call.name, call.arguments);
      } catch {
        return rpcError(id, -32602, "Invalid params");
      }
      try {
        const receipt = await dependencies.append(principal.accountId, event);
        const structuredContent = projectReceipt(receipt);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(structuredContent) }],
          structuredContent,
        });
      } catch {
        return rpcResult(id, {
          content: [{ type: "text", text: "AI World rejected the Control event." }],
          isError: true,
        });
      }
    },
  };
}

export function nativeChatProtectedResourceMetadata(resourceInput: string, issuerInput: string) {
  const resource = canonicalResource(resourceInput);
  const issuer = canonicalIssuer(issuerInput);
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [WRITE_SCOPE],
  };
}

function eventFromTool(name: z.infer<typeof ToolCallSchema>["name"], input: unknown) {
  if (name === "begin_run") {
    const args = BeginArgumentsSchema.parse(input ?? {});
    return NativeChatControlEventInputSchema.parse(envelope(args, "BEGIN_RUN", {}));
  }
  if (name === "commit_result") {
    const args = CommitArgumentsSchema.parse(input ?? {});
    return NativeChatControlEventInputSchema.parse(
      envelope(args, "COMMIT_RESULT", { result: args.structured_result }),
    );
  }
  if (name === "fail_run") {
    const args = FailArgumentsSchema.parse(input ?? {});
    return NativeChatControlEventInputSchema.parse(
      envelope(args, "FAIL", {
        failureCode: args.failure_code,
        message: args.message,
        retryable: args.retryable,
      }),
    );
  }
  const args = EmitArgumentsSchema.parse(input ?? {});
  switch (args.event_type) {
    case "heartbeat":
      return NativeChatControlEventInputSchema.parse(
        envelope(args, "HEARTBEAT", { progress: args.progress }),
      );
    case "finding":
      return NativeChatControlEventInputSchema.parse(
        envelope(args, "FINDING", { statement: args.statement, confidence: args.confidence }),
      );
    case "artifact":
      return NativeChatControlEventInputSchema.parse(
        envelope(args, "ARTIFACT", {
          artifactId: args.artifact_id,
          ...(args.note ? { note: args.note } : {}),
        }),
      );
    case "decision":
      return NativeChatControlEventInputSchema.parse(
        envelope(args, "DECISION", { decision: args.decision, rationale: args.rationale }),
      );
    case "handoff":
      return NativeChatControlEventInputSchema.parse(
        envelope(args, "HANDOFF", { targetAgentId: args.target_agent_id, summary: args.summary }),
      );
  }
}

function envelope(args: z.infer<typeof BeginArgumentsSchema>, eventType: string, payload: unknown) {
  return {
    schemaVersion: 1,
    runId: args.run_id,
    sequence: args.sequence,
    idempotencyKey: args.idempotency_key,
    eventType,
    payload,
  };
}

function projectReceipt(value: unknown) {
  const receipt = z
    .object({
      outcome: z.enum(["APPENDED", "REPLAY"]),
      state: z.object({ status: z.string(), lastSequence: z.number() }).optional(),
      occurredAt: z.string().optional(),
      event: z.object({ sequence: z.number() }).optional(),
    })
    .parse(value);
  return {
    outcome: receipt.outcome,
    ...(receipt.state
      ? { status: receipt.state.status, last_sequence: receipt.state.lastSequence }
      : {}),
    ...(receipt.occurredAt ? { occurred_at: receipt.occurredAt } : {}),
    ...(receipt.event ? { event_sequence: receipt.event.sequence } : {}),
  };
}

async function safeAuthorize(dependencies: NativeChatMcpDependencies, request: Request) {
  try {
    const principal = await dependencies.authorize(request);
    if (!principal) return undefined;
    return { accountId: AccountIdSchema.parse(principal.accountId), scopes: principal.scopes };
  } catch {
    return undefined;
  }
}

async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
    throw new Error("content type");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES))
    throw new Error("size");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("size");
  return JSON.parse(text) as unknown;
}

function acceptsMcpResponse(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && accept.includes("text/event-stream");
}

function supportsProtocol(request: Request) {
  const version = request.headers.get("mcp-protocol-version");
  return version === null || SUPPORTED_PROTOCOLS.has(version);
}

function isAllowedOrigin(request: Request, resource: string) {
  const origin = request.headers.get("origin");
  return (
    origin === null || origin === new URL(resource).origin || ALLOWED_REMOTE_ORIGINS.has(origin)
  );
}

function canonicalResource(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid MCP resource");
  return url.toString().replace(/\/$/, "");
}

function canonicalIssuer(input: string) {
  const issuer = canonicalResource(input);
  if (new URL(issuer).pathname.endsWith("/")) throw new Error("Invalid OAuth issuer");
  return issuer;
}

function protectedResourceMetadataUrl(resource: string) {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

function rpcResult(id: JsonRpcId, result: object) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: RESPONSE_HEADERS });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: RESPONSE_HEADERS },
  );
}

function plainError(code: string, status: number) {
  return Response.json({ error: { code } }, { status, headers: RESPONSE_HEADERS });
}

function stringSchema(minLength: number, maxLength: number) {
  return { type: "string", minLength, maxLength };
}
function integerSchema(minimum: number) {
  return { type: "integer", minimum };
}
function canonicalIdSchema(prefix: string) {
  return { type: "string", pattern: `^${prefix}_[0-9a-f-]{36}$` };
}
function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}
