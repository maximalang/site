import {
  type AgentConversationList,
  AgentConversationListSchema,
  type ConversationReadModel,
  ConversationReadModelSchema,
  type ConversationSendResponse,
  ConversationSendResponseSchema,
} from "@agent-world/read-model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ConversationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Conversation request failed");
    this.name = "ConversationApiError";
  }
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  let code = "CONVERSATION_UNAVAILABLE";
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string" && /^[A-Z_]{1,64}$/.test(body.error.code)) {
      code = body.error.code;
    }
  } catch {
    // Preserve the response status without reflecting an untrusted body.
  }
  throw new ConversationApiError(response.status, code);
}

export async function loadAgentConversations(
  agentId: string,
  fetcher: Fetcher = fetch,
): Promise<AgentConversationList> {
  const response = await requireOk(
    await fetcher(`/api/agents/${encodeURIComponent(agentId)}/conversations`, {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    }),
  );
  const parsed = AgentConversationListSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Agent conversation response");
  return parsed.data;
}

export async function loadConversation(
  conversationId: string,
  fetcher: Fetcher = fetch,
): Promise<ConversationReadModel> {
  const response = await requireOk(
    await fetcher(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    }),
  );
  const parsed = ConversationReadModelSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Conversation response");
  return parsed.data;
}

export async function sendConversationMessage(
  input: {
    conversationId: string;
    agentId: string;
    messageId: string;
    content: string;
    csrfToken: string;
  },
  fetcher: Fetcher = fetch,
): Promise<ConversationSendResponse> {
  const response = await requireOk(
    await fetcher(`/api/conversations/${encodeURIComponent(input.conversationId)}`, {
      body: JSON.stringify({
        schemaVersion: 1,
        messageId: input.messageId,
        agentId: input.agentId,
        content: input.content,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-World-CSRF": input.csrfToken,
      },
      method: "POST",
    }),
  );
  const parsed = ConversationSendResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Conversation send response");
  return parsed.data;
}
