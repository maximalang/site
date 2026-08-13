import { WorldReadModelSchema } from "@agent-world/read-model";
import { readWorldReadModel } from "../../../src/server/world-read-model";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type ReadWorldSource = () => Promise<unknown>;

export function createWorldRouteHandler(read: ReadWorldSource): () => Promise<Response> {
  return async () => {
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

export const GET = createWorldRouteHandler(readWorldReadModel);
