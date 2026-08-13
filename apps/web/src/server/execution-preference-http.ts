import {
  type ExecutionPreferenceLayer,
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  type ExecutionPreferenceSelection,
  ExecutionPreferenceSelectionSchema,
} from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 8_192;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type ExecutionPreferenceHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  read(selection: ExecutionPreferenceSelection): Promise<unknown>;
  write(layer: ExecutionPreferenceLayer, updatedAt: string): Promise<void>;
  now?: () => Date;
};

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

function selection(request: Request): ExecutionPreferenceSelection {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["projectId", "agentId", "taskId"]);
  for (const [key] of parameters) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) throw new Error("INVALID_QUERY");
  }
  return ExecutionPreferenceSelectionSchema.parse({
    ...(parameters.has("projectId") ? { projectId: parameters.get("projectId") } : {}),
    ...(parameters.has("agentId") ? { agentId: parameters.get("agentId") } : {}),
    ...(parameters.has("taskId") ? { taskId: parameters.get("taskId") } : {}),
  });
}

async function body(request: Request): Promise<ExecutionPreferenceLayer> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("INVALID_CONTENT_TYPE");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new Error("INVALID_CONTENT_LENGTH");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error("OVERSIZED");
  return ExecutionPreferenceLayerSchema.parse(JSON.parse(text) as unknown);
}

export function createExecutionPreferenceRouteHandler(
  dependencies: ExecutionPreferenceHttpDependencies,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method === "GET") {
      try {
        const model = ExecutionPreferenceReadModelSchema.parse(
          await dependencies.read(selection(request)),
        );
        return Response.json(model, { headers: RESPONSE_HEADERS });
      } catch (cause) {
        if (cause instanceof Error && cause.message === "INVALID_SCOPE_CHAIN") {
          return error("INVALID_SCOPE_CHAIN", 422);
        }
        return error("INVALID_REQUEST", 400);
      }
    }
    if (request.method !== "PUT" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    try {
      await dependencies.write(
        await body(request),
        (dependencies.now ?? (() => new Date()))().toISOString(),
      );
      return new Response(null, { headers: RESPONSE_HEADERS, status: 204 });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "RUN_SCOPE_NOT_AVAILABLE") {
        return error("RUN_SCOPE_NOT_AVAILABLE", 409);
      }
      return error("INVALID_REQUEST", 400);
    }
  };
}
