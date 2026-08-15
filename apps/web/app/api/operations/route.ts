import { OperationsReadModelSchema } from "@agent-world/read-model";
import {
  authorizeApplicationRequest,
  readApplicationOperations,
} from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export function createOperationsRouteHandler(
  read: () => Promise<unknown>,
  authorize: (request: Request) => Promise<boolean>,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await authorize(request)) !== true) {
        return Response.json(
          { error: { code: "UNAUTHORIZED" } },
          { headers: HEADERS, status: 401 },
        );
      }
    } catch {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { headers: HEADERS, status: 401 });
    }
    try {
      return Response.json(OperationsReadModelSchema.parse(await read()), { headers: HEADERS });
    } catch {
      return Response.json(
        { error: { code: "OPERATIONS_READ_MODEL_UNAVAILABLE" } },
        { headers: HEADERS, status: 503 },
      );
    }
  };
}

export const GET = createOperationsRouteHandler(
  readApplicationOperations,
  authorizeApplicationRequest,
);
