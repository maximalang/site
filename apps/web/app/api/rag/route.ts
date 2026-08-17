import { createRagRouteHandler } from "../../../src/server/rag-http";
import { applicationRagDependencies } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createRagRouteHandler(applicationRagDependencies);
