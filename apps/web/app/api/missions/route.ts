import { createMissionRouteHandler } from "../../../src/server/mission-http";
import { applicationMissionDependencies } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
export const POST = createMissionRouteHandler(applicationMissionDependencies);
