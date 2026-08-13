import { applicationTaskDependencies } from "../../../src/server/runtime-proxy";
import { createTaskRouteHandler } from "../../../src/server/task-http";

export const dynamic = "force-dynamic";

export const POST = createTaskRouteHandler(applicationTaskDependencies);
