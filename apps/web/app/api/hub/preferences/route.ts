import { createExecutionPreferenceRouteHandler } from "../../../../src/server/execution-preference-http";
import { applicationExecutionPreferenceDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const handler = createExecutionPreferenceRouteHandler(applicationExecutionPreferenceDependencies);

export const GET = handler;
export const PUT = handler;
