import { isHubCommandStoreError } from "@agent-world/postgres-store";
import {
  type HubCommandRequest,
  HubCommandRequestSchema,
  HubCommandResponseSchema,
} from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 32_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type HubCommandHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  execute(command: HubCommandRequest): Promise<unknown>;
};

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Invalid content type");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES)
  ) {
    throw new Error("Invalid content length");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Hub command is too large");
  }
  return JSON.parse(text) as unknown;
}

export function createHubCommandRouteHandler(dependencies: HubCommandHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    let command: HubCommandRequest;
    try {
      command = HubCommandRequestSchema.parse(await readBody(request));
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const response = HubCommandResponseSchema.parse(await dependencies.execute(command));
      return Response.json(response, {
        headers: RESPONSE_HEADERS,
        status: response.outcome === "CREATED" ? 201 : 200,
      });
    } catch (cause) {
      if (isHubCommandStoreError(cause)) {
        return error(cause.code, cause.code === "INVALID_REFERENCE" ? 422 : 409);
      }
      return error("HUB_COMMAND_UNAVAILABLE", 503);
    }
  };
}
