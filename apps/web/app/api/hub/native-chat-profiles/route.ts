import { createNativeChatProfileRouteHandler } from "../../../../src/server/native-chat-profile-http";
import { applicationNativeChatProfileDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const handler = createNativeChatProfileRouteHandler(applicationNativeChatProfileDependencies);

export const GET = handler;
export const PUT = handler;
