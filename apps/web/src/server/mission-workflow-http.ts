import { EventIdSchema, MissionIdSchema, RunIdSchema, TaskIdSchema } from "@agent-world/domain";
import * as z from "zod";
import { hasSameOriginHost } from "./request-security";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const ResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  missionId: MissionIdSchema,
  taskIds: z.array(TaskIdSchema),
  runIds: z.array(RunIdSchema),
  completedTaskIds: z.array(TaskIdSchema),
  failedTaskIds: z.array(TaskIdSchema),
  lastEventId: EventIdSchema.optional(),
  phase: z.enum(["PLANNING", "EXECUTING", "REVIEWING", "COMPLETED", "FAILED"]),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  reviewRequired: z.boolean(),
  pendingAction: z
    .enum([
      "DECOMPOSE_MISSION",
      "DISPATCH_READY_TASKS",
      "WAIT_FOR_RUNS",
      "RETRY_FAILED_TASKS",
      "REVIEW_RESULTS",
      "RECORD_SUCCESS",
      "RECORD_FAILURE",
    ])
    .optional(),
});

export type MissionWorkflowHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  advance(missionId: string): Promise<unknown>;
};

function error(code: string, status: number) {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

export function createMissionWorkflowRouteHandler(dependencies: MissionWorkflowHttpDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    let missionId: string;
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
        throw new Error("Invalid content type");
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 1_024) throw new Error("Request too large");
      const body = JSON.parse(text) as { missionId?: unknown };
      if (Object.keys(body).length !== 1) throw new Error("Unexpected request fields");
      missionId = MissionIdSchema.parse(body.missionId);
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      return Response.json(ResultSchema.parse(await dependencies.advance(missionId)), {
        headers: RESPONSE_HEADERS,
      });
    } catch {
      return error("MISSION_WORKFLOW_UNAVAILABLE", 503);
    }
  };
}
