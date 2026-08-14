import { createMissionWorkflowRouteHandler } from "../../../../src/server/mission-workflow-http";
import { applicationMissionWorkflowDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createMissionWorkflowRouteHandler(applicationMissionWorkflowDependencies);
