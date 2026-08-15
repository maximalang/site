import { applicationScheduleDependencies } from "../../../src/server/runtime-proxy";
import { createScheduleRouteHandlers } from "../../../src/server/schedule-http";

export const runtime = "nodejs";
const handlers = createScheduleRouteHandlers(applicationScheduleDependencies);
export const GET = handlers.GET;
export const POST = handlers.POST;
