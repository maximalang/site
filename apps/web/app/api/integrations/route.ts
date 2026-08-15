import { createIntegrationRouteHandlers } from "../../../src/server/integration-http";
import { applicationIntegrationDependencies } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
const handlers = createIntegrationRouteHandlers(applicationIntegrationDependencies);
export const GET = handlers.GET;
export const POST = handlers.POST;
