import { createAgentConversationRouteHandler } from "../../../../../src/server/agent-conversation-http";
import { applicationAgentConversationDependencies } from "../../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const GET = createAgentConversationRouteHandler(applicationAgentConversationDependencies);
