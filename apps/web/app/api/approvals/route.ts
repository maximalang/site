import { createApprovalRouteHandler } from "../../../src/server/approval-http";
import { applicationApprovalDependencies } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createApprovalRouteHandler(applicationApprovalDependencies);
