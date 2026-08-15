import {
  AgentIdSchema,
  MissionIdSchema,
  ProjectIdSchema,
  ScheduleIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";
import type { ScheduleCreateInput } from "./application-runtime";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 32_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const CreateScheduleSchema = z.strictObject({
  id: ScheduleIdSchema,
  projectId: ProjectIdSchema,
  agentId: AgentIdSchema,
  missionId: MissionIdSchema.optional(),
  title: z.string().trim().min(1).max(200),
  taskDescription: z.string().trim().min(1).max(20_000).optional(),
  cronExpression: z.string().trim().min(9).max(128),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/),
  isEnabled: z.boolean(),
});

export type ScheduleHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  list(limit: number): Promise<unknown>;
  create(input: ScheduleCreateInput, createdAt: string): Promise<unknown>;
  now?: () => Date;
};

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: RESPONSE_HEADERS });
}

export function createScheduleRouteHandlers(dependencies: ScheduleHttpDependencies) {
  const now = dependencies.now ?? (() => new Date());
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
        const url = new URL(request.url);
        const rawLimit = url.searchParams.get("limit") ?? "100";
        if (!/^\d{1,3}$/.test(rawLimit)) return error("INVALID_REQUEST", 400);
        const schedules = await dependencies.list(Number(rawLimit));
        return Response.json({ schemaVersion: 1, schedules }, { headers: RESPONSE_HEADERS });
      } catch {
        return error("SCHEDULES_UNAVAILABLE", 503);
      }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
      } catch {
        return error("UNAUTHORIZED", 401);
      }
      if (!hasSameOriginHost(request)) return error("INVALID_REQUEST", 400);
      let input: z.infer<typeof CreateScheduleSchema>;
      try {
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
          throw new Error("content type");
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES)
          throw new Error("body too large");
        input = CreateScheduleSchema.parse(JSON.parse(text));
      } catch {
        return error("INVALID_REQUEST", 400);
      }
      try {
        const schedule = await dependencies.create(
          input,
          TimestampSchema.parse(now().toISOString()),
        );
        return Response.json(
          { schemaVersion: 1, schedule },
          { status: 201, headers: RESPONSE_HEADERS },
        );
      } catch {
        return error("SCHEDULE_CONFLICT", 409);
      }
    },
  };
}
