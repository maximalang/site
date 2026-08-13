import { WorldReadModelSchema } from "@agent-world/read-model";
import {
  authorizeApplicationRequest,
  readApplicationWorld,
} from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type ReadWorldSource = () => Promise<unknown>;
type AuthorizeWorldRequest = (request: Request) => Promise<boolean>;

export function createWorldRouteHandler(
  read: ReadWorldSource,
  authorize: AuthorizeWorldRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      if ((await authorize(request)) !== true) {
        return Response.json(
          { error: { code: "UNAUTHORIZED" } },
          { headers: RESPONSE_HEADERS, status: 401 },
        );
      }
    } catch {
      return Response.json(
        { error: { code: "UNAUTHORIZED" } },
        { headers: RESPONSE_HEADERS, status: 401 },
      );
    }
    try {
      const model = WorldReadModelSchema.parse(await read());
      return Response.json(model, { headers: RESPONSE_HEADERS });
    } catch {
      return Response.json(
        { error: { code: "WORLD_READ_MODEL_UNAVAILABLE" } },
        { headers: RESPONSE_HEADERS, status: 503 },
      );
    }
  };
}

export const GET = createWorldRouteHandler(readApplicationWorld, authorizeApplicationRequest);
