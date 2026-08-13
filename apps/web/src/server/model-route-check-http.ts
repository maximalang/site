import type { ModelRouteId } from "@agent-world/domain";
import {
  ModelRouteCheckRequestSchema,
  ModelRouteCheckResponseSchema,
} from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

export function createModelRouteCheckHandler(dependencies: {
  authorize(request: Request): Promise<boolean>;
  check(modelRouteId: ModelRouteId): Promise<unknown>;
}) {
  return async (request: Request): Promise<Response> => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    try {
      if (!(await dependencies.authorize(request))) {
        return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
      }
    } catch {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 400, headers });
    }
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 2_048) throw new Error("oversized");
      const input = ModelRouteCheckRequestSchema.parse(JSON.parse(body));
      const result = ModelRouteCheckResponseSchema.parse(
        await dependencies.check(input.modelRouteId),
      );
      return Response.json(result, { status: 200, headers });
    } catch {
      return Response.json(
        { error: { code: "MODEL_ROUTE_CHECK_FAILED" } },
        { status: 503, headers },
      );
    }
  };
}
