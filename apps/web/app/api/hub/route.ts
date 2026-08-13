import { HubReadModelSchema } from "@agent-world/read-model";
import { authorizeApplicationRequest, readApplicationHub } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type ReadHubSource = () => Promise<unknown>;
type AuthorizeHubRequest = (request: Request) => Promise<boolean>;

export function createHubRouteHandler(
  read: ReadHubSource,
  authorize: AuthorizeHubRequest,
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
      return Response.json(HubReadModelSchema.parse(await read()), { headers: RESPONSE_HEADERS });
    } catch {
      return Response.json(
        { error: { code: "HUB_READ_MODEL_UNAVAILABLE" } },
        { headers: RESPONSE_HEADERS, status: 503 },
      );
    }
  };
}

export const GET = createHubRouteHandler(readApplicationHub, authorizeApplicationRequest);
