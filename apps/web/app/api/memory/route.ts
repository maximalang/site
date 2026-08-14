import { createMemoryRouteHandler } from "../../../src/server/memory-http";
import { applicationMemoryDependencies } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const handler = createMemoryRouteHandler(applicationMemoryDependencies);

export const GET = handler;
export const POST = handler;
