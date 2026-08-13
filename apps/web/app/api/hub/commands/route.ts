import { createHubCommandRouteHandler } from "../../../../src/server/hub-command-http";
import { applicationHubCommandDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createHubCommandRouteHandler(applicationHubCommandDependencies);
