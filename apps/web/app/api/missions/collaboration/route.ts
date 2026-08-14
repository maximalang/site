import { createMissionCollaborationRouteHandler } from "../../../../src/server/mission-collaboration-http";
import { applicationMissionCollaborationDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createMissionCollaborationRouteHandler(
  applicationMissionCollaborationDependencies,
);
