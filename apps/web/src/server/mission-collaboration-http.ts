import {
  MissionDecompositionSchema,
  StructuredMeetingSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 256_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const RequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("DECOMPOSE"), decomposition: MissionDecompositionSchema }),
  z.strictObject({ operation: z.literal("MEETING"), meeting: StructuredMeetingSchema }),
]);

export type MissionCollaborationHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  createDecomposition(
    input: z.infer<typeof MissionDecompositionSchema>,
    materializedAt: string,
  ): Promise<unknown>;
  recordMeeting(input: z.infer<typeof StructuredMeetingSchema>): Promise<unknown>;
  now?: () => Date;
};

function error(code: string, status: number) {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

export function createMissionCollaborationRouteHandler(
  dependencies: MissionCollaborationHttpDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    let input: z.infer<typeof RequestSchema>;
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
        throw new Error("Invalid content type");
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
        throw new Error("Mission collaboration request is too large");
      }
      input = RequestSchema.parse(JSON.parse(text));
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const result =
        input.operation === "DECOMPOSE"
          ? await dependencies.createDecomposition(
              input.decomposition,
              TimestampSchema.parse(now().toISOString()),
            )
          : await dependencies.recordMeeting(input.meeting);
      return Response.json(
        { schemaVersion: 1, operation: input.operation, result },
        { headers: RESPONSE_HEADERS },
      );
    } catch {
      return error("MISSION_COLLABORATION_CONFLICT", 409);
    }
  };
}
