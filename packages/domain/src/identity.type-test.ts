import type { AccountId, AgentId, RouteId, SessionId } from "./index.js";

declare const accountId: AccountId;
declare const agentId: AgentId;
declare const routeId: RouteId;
declare const sessionId: SessionId;

function acceptsAgentId(_id: AgentId): void {}
function acceptsRouteId(_id: RouteId): void {}

acceptsAgentId(agentId);
acceptsRouteId(routeId);

// @ts-expect-error Account identity cannot be used as Agent identity.
acceptsAgentId(accountId);

// @ts-expect-error Session identity cannot be used as Agent identity.
acceptsAgentId(sessionId);

// @ts-expect-error Agent identity cannot be used as Route identity.
acceptsRouteId(agentId);
