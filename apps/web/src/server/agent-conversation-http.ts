import { type AgentId, AgentIdSchema } from "@agent-world/domain";
import { AgentConversationListSchema } from "@agent-world/read-model";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type RouteContext = { params: Promise<{ agentId: string }> };

export type AgentConversationHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  read(agentId: AgentId): Promise<unknown | undefined>;
};

function errorResponse(
  code: "UNAUTHORIZED" | "INVALID_REQUEST" | "AGENT_NOT_FOUND" | "CONVERSATION_INDEX_UNAVAILABLE",
  status: number,
) {
  return Response.json({ error: { code } }, { status, headers: RESPONSE_HEADERS });
}

export function createAgentConversationRouteHandler(
  dependencies: AgentConversationHttpDependencies,
) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) {
        return errorResponse("UNAUTHORIZED", 401);
      }
    } catch {
      return errorResponse("UNAUTHORIZED", 401);
    }

    let agentId: AgentId;
    try {
      agentId = AgentIdSchema.parse((await context.params).agentId);
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const model = await dependencies.read(agentId);
      if (model === undefined) {
        return errorResponse("AGENT_NOT_FOUND", 404);
      }
      return Response.json(AgentConversationListSchema.parse(model), { headers: RESPONSE_HEADERS });
    } catch {
      return errorResponse("CONVERSATION_INDEX_UNAVAILABLE", 503);
    }
  };
}
