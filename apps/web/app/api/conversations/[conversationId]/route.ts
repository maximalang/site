import { createConversationRouteHandlers } from "../../../../src/server/conversation-http";
import { applicationConversationDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const handlers = createConversationRouteHandlers(applicationConversationDependencies);
export const GET = handlers.GET;
export const POST = handlers.POST;
