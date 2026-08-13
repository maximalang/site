import { IdempotencyKeySchema, TimestampSchema } from "@agent-world/domain";
import { type AssignTaskInput, isTaskAssignmentStoreError } from "@agent-world/postgres-store";
import { TaskAssignmentRequestSchema, TaskAssignmentResponseSchema } from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 24_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type TaskHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  assign(input: AssignTaskInput): Promise<unknown>;
  now?: () => Date;
};

function error(code: string, status: number) {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Invalid content type");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Task request is too large");
  }
  return JSON.parse(text) as unknown;
}

export function createTaskRouteHandler(dependencies: TaskHttpDependencies) {
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
    let input: AssignTaskInput;
    try {
      const body = TaskAssignmentRequestSchema.parse(await readBody(request));
      input = {
        taskId: body.taskId,
        conversationId: body.conversationId,
        agentId: body.agentId,
        title: body.title,
        ...(body.description === undefined ? {} : { description: body.description }),
        idempotencyKey: IdempotencyKeySchema.parse(`task:${body.taskId.slice("task_".length)}`),
        createdAt: TimestampSchema.parse(now().toISOString()),
      };
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const result = TaskAssignmentResponseSchema.parse({
        schemaVersion: 1,
        ...((await dependencies.assign(input)) as object),
      });
      return Response.json(result, {
        headers: RESPONSE_HEADERS,
        status: result.outcome === "CREATED" ? 201 : 200,
      });
    } catch (cause) {
      if (isTaskAssignmentStoreError(cause)) {
        return error(cause.code, 409);
      }
      return error("TASK_ASSIGNMENT_UNAVAILABLE", 503);
    }
  };
}
