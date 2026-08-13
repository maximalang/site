import { createOwnerAuthHttpHandlers } from "../../../../src/server/owner-auth-http";
import { applicationAuthPort } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const handlers = createOwnerAuthHttpHandlers(applicationAuthPort);
export const GET = handlers.session;
