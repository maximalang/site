import { createModelRouteCheckHandler } from "../../../../../src/server/model-route-check-http";
import { applicationModelRouteCheckDependencies } from "../../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
export const POST = createModelRouteCheckHandler(applicationModelRouteCheckDependencies);
