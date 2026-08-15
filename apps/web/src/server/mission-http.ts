import { MissionSchema } from "@agent-world/domain";
import * as z from "zod";
import { hasSameOriginHost } from "./request-security";

const ResultSchema = z.strictObject({
  outcome: z.enum(["CREATED", "REPLAY"]),
  mission: MissionSchema,
});
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const error = (code: string, status: number) =>
  Response.json({ error: { code } }, { headers, status });

export function createMissionRouteHandler(dependencies: {
  authorize(request: Request): Promise<boolean>;
  create(mission: z.infer<typeof MissionSchema>): Promise<unknown>;
}) {
  return async (request: Request) => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request))
      return error("INVALID_REQUEST", 400);
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
        throw new Error("content-type");
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 65_536) throw new Error("large");
      const result = ResultSchema.parse(
        await dependencies.create(MissionSchema.parse(JSON.parse(text))),
      );
      return Response.json(
        { schemaVersion: 1, ...result },
        { headers, status: result.outcome === "CREATED" ? 201 : 200 },
      );
    } catch {
      return error("MISSION_COMMAND_REJECTED", 409);
    }
  };
}
