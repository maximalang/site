import { ApprovalIdSchema, CommandIdSchema, TimestampSchema } from "@agent-world/domain";
import { type ApprovalDecisionInput, isApprovalRunStoreError } from "@agent-world/postgres-store";
import {
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResponseSchema,
} from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 4_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type ApprovalHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  decide(input: ApprovalDecisionInput): Promise<unknown>;
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
    throw new Error("Approval request is too large");
  }
  return JSON.parse(text) as unknown;
}

export function createApprovalRouteHandler(dependencies: ApprovalHttpDependencies) {
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
    let input: ApprovalDecisionInput;
    try {
      const body = ApprovalDecisionRequestSchema.parse(await readBody(request));
      input = {
        taskId: body.taskId,
        approvalId: ApprovalIdSchema.parse(`approval_${body.taskId.slice("task_".length)}`),
        decision: body.decision,
        ...(body.decision === "APPROVE" ? {} : { reason: body.reason }),
        commandId: CommandIdSchema.parse(
          `approval-decision:${body.decision.toLowerCase()}:${body.decisionId}`,
        ),
        decidedAt: TimestampSchema.parse(now().toISOString()),
      } as ApprovalDecisionInput;
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const result = ApprovalDecisionResponseSchema.parse({
        schemaVersion: 1,
        ...((await dependencies.decide(input)) as object),
      });
      return Response.json(result, { headers: RESPONSE_HEADERS, status: 200 });
    } catch (cause) {
      if (isApprovalRunStoreError(cause)) {
        return error(cause.code, cause.code === "APPROVAL_NOT_FOUND" ? 404 : 409);
      }
      return error("APPROVAL_DECISION_UNAVAILABLE", 503);
    }
  };
}
