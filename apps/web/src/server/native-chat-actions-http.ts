import { AccountIdSchema } from "@agent-world/domain";
import * as z from "zod";
import {
  invokeNativeChatControlTool,
  type NativeChatControlToolName,
  type NativeChatMcpDependencies,
} from "./native-chat-mcp-http";

const WRITE_SCOPE = "ai_world.run.write";
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};
const ALLOWED_REMOTE_ORIGINS = new Set(["https://chatgpt.com", "https://chat.openai.com"]);
const OperationSchema = z.enum(["begin", "resources", "events", "commit", "fail"]);
const TOOL_BY_OPERATION: Record<z.infer<typeof OperationSchema>, NativeChatControlToolName> = {
  begin: "begin_run",
  resources: "get_run_resources",
  events: "emit_run_event",
  commit: "commit_result",
  fail: "fail_run",
};

export function createNativeChatActionsHandlers(dependencies: NativeChatMcpDependencies) {
  const resource = secureUrl(dependencies.resource);
  return {
    POST: async (request: Request, operationInput: unknown): Promise<Response> => {
      if (!isAllowedOrigin(request, resource)) return error("ORIGIN_NOT_ALLOWED", 403);
      const operation = OperationSchema.safeParse(operationInput);
      if (!operation.success) return error("NOT_FOUND", 404);
      const principal = await safeAuthorize(dependencies, request);
      if (!principal?.scopes.has(WRITE_SCOPE)) {
        return error("UNAUTHORIZED", 401, {
          "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(resource)}", scope="${WRITE_SCOPE}"`,
        });
      }
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return error("INVALID_REQUEST", 400);
      }
      try {
        const result = await invokeNativeChatControlTool(
          dependencies,
          principal.accountId,
          TOOL_BY_OPERATION[operation.data],
          body,
        );
        return Response.json(result, { headers: RESPONSE_HEADERS });
      } catch (cause) {
        if (cause instanceof z.ZodError) return error("INVALID_REQUEST", 400);
        return error("CONTROL_OPERATION_REJECTED", 409);
      }
    },
  };
}

export function nativeChatActionsOpenApi(resourceInput: string, issuerInput: string) {
  const resource = secureUrl(resourceInput);
  const issuer = secureUrl(issuerInput);
  const base = new URL(resource).origin;
  return {
    openapi: "3.1.0",
    info: {
      title: "AI World Native Chat Actions",
      version: "0.1.0",
      description:
        "Fallback adapter for AI World Runs. Account identity is always derived from OAuth.",
    },
    servers: [{ url: base }],
    paths: {
      "/api/chat-actions/runs/begin": action(
        "beginRun",
        "Attach to an assigned Run",
        beginSchema(),
      ),
      "/api/chat-actions/runs/resources": action(
        "getRunResources",
        "Pull bounded Run context lazily",
        resourcesSchema(),
      ),
      "/api/chat-actions/runs/events": action(
        "emitRunEvent",
        "Append structured progress",
        eventSchema(),
      ),
      "/api/chat-actions/runs/commit": action(
        "commitResult",
        "Commit the terminal structured result before the final Chat response",
        commitSchema(),
      ),
      "/api/chat-actions/runs/fail": action("failRun", "Fail the Run terminally", failSchema()),
    },
    components: {
      securitySchemes: {
        oauth: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${issuer}/auth`,
              tokenUrl: `${issuer}/token`,
              scopes: { [WRITE_SCOPE]: "Read and update assigned AI World Runs" },
            },
          },
        },
      },
    },
  } as const;
}

function action(operationId: string, summary: string, schema: Record<string, unknown>) {
  return {
    post: {
      operationId,
      summary,
      security: [{ oauth: [WRITE_SCOPE] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema } },
      },
      responses: {
        "200": { description: "Canonical AI World response" },
        "400": { description: "Invalid request" },
        "401": { description: "OAuth authorization required" },
        "409": { description: "Canonical operation rejected" },
      },
    },
  };
}

const id = (prefix: string) => ({ type: "string", pattern: `^${prefix}_[0-9a-f-]{36}$` });
const sequenceFields = () => ({
  run_id: id("run"),
  sequence: { type: "integer", minimum: 1 },
  idempotency_key: { type: "string", minLength: 3, maxLength: 200 },
});
const strictObject = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
function beginSchema() {
  return strictObject(sequenceFields(), ["run_id", "sequence", "idempotency_key"]);
}
function resourcesSchema() {
  return strictObject(
    {
      run_id: id("run"),
      resources: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["TASK", "PROJECT_STATE", "MEMORY", "RAG", "SKILLS", "ARTIFACTS", "ACTION_HISTORY"],
        },
      },
      query: { type: "string", minLength: 1, maxLength: 2_000 },
      max_items: { type: "integer", minimum: 1, maximum: 100 },
      max_tokens: { type: "integer", minimum: 64, maximum: 100_000 },
    },
    ["run_id", "resources", "max_items", "max_tokens"],
  );
}
function eventSchema() {
  return strictObject(
    {
      ...sequenceFields(),
      event_type: {
        type: "string",
        enum: ["heartbeat", "finding", "artifact", "decision", "handoff"],
      },
      progress: { type: "string", minLength: 1, maxLength: 2_000 },
      statement: { type: "string", minLength: 1, maxLength: 8_000 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      artifact_id: id("artifact"),
      note: { type: "string", minLength: 1, maxLength: 2_000 },
      decision: { type: "string", minLength: 1, maxLength: 8_000 },
      rationale: { type: "string", minLength: 1, maxLength: 8_000 },
      target_agent_id: id("agent"),
      summary: { type: "string", minLength: 1, maxLength: 20_000 },
    },
    ["run_id", "sequence", "idempotency_key", "event_type"],
  );
}
function commitSchema() {
  return strictObject(
    { ...sequenceFields(), structured_result: { type: "object", additionalProperties: true } },
    ["run_id", "sequence", "idempotency_key", "structured_result"],
  );
}
function failSchema() {
  return strictObject(
    {
      ...sequenceFields(),
      failure_code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$" },
      message: { type: "string", minLength: 1, maxLength: 8_000 },
      retryable: { type: "boolean" },
    },
    ["run_id", "sequence", "idempotency_key", "failure_code", "message", "retryable"],
  );
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
function isAllowedOrigin(request: Request, resource: string) {
  const origin = request.headers.get("origin");
  return (
    origin === null || origin === new URL(resource).origin || ALLOWED_REMOTE_ORIGINS.has(origin)
  );
}
function secureUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("HTTPS URL required");
  return url.toString().replace(/\/$/, "");
}
function protectedResourceMetadataUrl(resource: string) {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
function error(code: string, status: number, headers: Record<string, string> = {}) {
  return Response.json(
    { error: { code } },
    { status, headers: { ...RESPONSE_HEADERS, ...headers } },
  );
}
