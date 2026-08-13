import {
  ConversationSendError,
  type ConversationSendResult,
} from "@agent-world/conversation-service";
import { ConversationIdSchema, type SendMessageIntent, TimestampSchema } from "@agent-world/domain";
import {
  ConversationMessageCursorSchema,
  ConversationReadModelSchema,
  ConversationSendRequestSchema,
  ConversationSendResponseSchema,
  MAX_CONVERSATION_PAGE_MESSAGES,
  projectConversationMessage,
} from "@agent-world/read-model";

const MAX_REQUEST_BYTES = 40_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type RouteContext = { params: Promise<{ conversationId: string }> };
type ConversationReadInput = {
  conversationId: SendMessageIntent["conversationId"];
  olderThan?: { createdAt: string; messageId: SendMessageIntent["id"] };
  limit?: number;
};

export type ConversationHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  read(input: ConversationReadInput): Promise<unknown | undefined>;
  send(input: SendMessageIntent): Promise<ConversationSendResult>;
  now?: () => Date;
};

export type ConversationRouteHandlers = {
  GET(request: Request, context: RouteContext): Promise<Response>;
  POST(request: Request, context: RouteContext): Promise<Response>;
};

type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "CONVERSATION_NOT_FOUND"
  | "AGENT_MISMATCH"
  | "NO_ACTIVE_SESSION"
  | "IDEMPOTENCY_CONFLICT"
  | "CONVERSATION_READ_UNAVAILABLE"
  | "CONVERSATION_SEND_UNAVAILABLE";

function errorResponse(code: ErrorCode, status: number): Response {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

async function isAuthorized(
  authorize: ConversationHttpDependencies["authorize"],
  request: Request,
): Promise<boolean> {
  try {
    return (await authorize(request)) === true;
  } catch {
    return false;
  }
}

function hasSafeMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin && (fetchSite === null || fetchSite === "same-origin")
  );
}

function parseReadInput(request: Request, conversationIdInput: string): ConversationReadInput {
  const conversationId = ConversationIdSchema.parse(conversationIdInput);
  const search = new URL(request.url).searchParams;
  const allowed = new Set(["limit", "beforeCreatedAt", "beforeMessageId"]);
  for (const key of search.keys()) {
    if (!allowed.has(key) || search.getAll(key).length !== 1) {
      throw new Error("Invalid query");
    }
  }

  const limitText = search.get("limit");
  const beforeCreatedAt = search.get("beforeCreatedAt");
  const beforeMessageId = search.get("beforeMessageId");
  if ((beforeCreatedAt === null) !== (beforeMessageId === null)) {
    throw new Error("Incomplete cursor");
  }
  const limit =
    limitText === null || !/^[1-9][0-9]{0,2}$/.test(limitText) ? undefined : Number(limitText);
  if (limitText !== null && (limit === undefined || limit > MAX_CONVERSATION_PAGE_MESSAGES)) {
    throw new Error("Invalid limit");
  }
  const olderThan =
    beforeCreatedAt === null || beforeMessageId === null
      ? undefined
      : ConversationMessageCursorSchema.parse({
          createdAt: beforeCreatedAt,
          messageId: beforeMessageId,
        });

  return {
    conversationId,
    ...(olderThan ? { olderThan } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Invalid content type");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES)
  ) {
    throw new Error("Invalid content length");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Body too large");
  }
  return JSON.parse(text) as unknown;
}

function sendErrorResponse(error: unknown): Response {
  if (!(error instanceof ConversationSendError)) {
    return errorResponse("CONVERSATION_SEND_UNAVAILABLE", 503);
  }
  switch (error.code) {
    case "INVALID_INTENT":
      return errorResponse("INVALID_REQUEST", 400);
    case "CONVERSATION_NOT_FOUND":
      return errorResponse("CONVERSATION_NOT_FOUND", 404);
    case "AGENT_MISMATCH":
      return errorResponse("AGENT_MISMATCH", 409);
    case "NO_ACTIVE_SESSION":
      return errorResponse("NO_ACTIVE_SESSION", 409);
    case "IDEMPOTENCY_CONFLICT":
      return errorResponse("IDEMPOTENCY_CONFLICT", 409);
    case "PERSISTENCE_FAILED":
    case "DELIVERY_UNAVAILABLE":
    case "DELIVERY_FAILED":
      return errorResponse("CONVERSATION_SEND_UNAVAILABLE", 503);
  }
}

export function createConversationRouteHandlers(
  dependencies: ConversationHttpDependencies,
): ConversationRouteHandlers {
  const now = dependencies.now ?? (() => new Date());

  return {
    async GET(request, context) {
      if (!(await isAuthorized(dependencies.authorize, request))) {
        return errorResponse("UNAUTHORIZED", 401);
      }
      let input: ConversationReadInput;
      try {
        input = parseReadInput(request, (await context.params).conversationId);
      } catch {
        return errorResponse("INVALID_REQUEST", 400);
      }
      try {
        const model = await dependencies.read(input);
        if (model === undefined) {
          return errorResponse("CONVERSATION_NOT_FOUND", 404);
        }
        return Response.json(ConversationReadModelSchema.parse(model), {
          headers: RESPONSE_HEADERS,
        });
      } catch {
        return errorResponse("CONVERSATION_READ_UNAVAILABLE", 503);
      }
    },

    async POST(request, context) {
      if (!(await isAuthorized(dependencies.authorize, request))) {
        return errorResponse("UNAUTHORIZED", 401);
      }
      if (!hasSafeMutationOrigin(request)) {
        return errorResponse("INVALID_REQUEST", 400);
      }
      let intent: SendMessageIntent;
      try {
        const conversationId = ConversationIdSchema.parse((await context.params).conversationId);
        const body = ConversationSendRequestSchema.parse(await readJsonBody(request));
        intent = {
          schemaVersion: 1,
          id: body.messageId,
          conversationId,
          agentId: body.agentId,
          content: body.content,
          idempotencyKey: `message:${body.messageId.slice("message_".length)}`,
          createdAt: TimestampSchema.parse(now().toISOString()),
        };
      } catch {
        return errorResponse("INVALID_REQUEST", 400);
      }
      try {
        const result = await dependencies.send(intent);
        return Response.json(
          ConversationSendResponseSchema.parse({
            schemaVersion: 1,
            outcome: result.outcome,
            message: projectConversationMessage(result.message),
          }),
          { headers: RESPONSE_HEADERS },
        );
      } catch (error) {
        return sendErrorResponse(error);
      }
    },
  };
}
