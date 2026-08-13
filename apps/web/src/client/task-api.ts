import { type TaskAssignmentResponse, TaskAssignmentResponseSchema } from "@agent-world/read-model";
import { ConversationApiError } from "./conversation-api";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function assignTask(
  input: {
    taskId: string;
    conversationId: string;
    agentId: string;
    title: string;
    description?: string;
    csrfToken: string;
  },
  fetcher: Fetcher = fetch,
): Promise<TaskAssignmentResponse> {
  const response = await fetcher("/api/tasks", {
    body: JSON.stringify({
      schemaVersion: 1,
      taskId: input.taskId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-World-CSRF": input.csrfToken,
    },
    method: "POST",
  });
  if (!response.ok) {
    let code = "TASK_ASSIGNMENT_UNAVAILABLE";
    try {
      const body = (await response.json()) as { error?: { code?: unknown } };
      if (typeof body.error?.code === "string" && /^[A-Z_]{1,64}$/.test(body.error.code)) {
        code = body.error.code;
      }
    } catch {
      // Keep the bounded fallback code.
    }
    throw new ConversationApiError(response.status, code);
  }
  const parsed = TaskAssignmentResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid task assignment response");
  return parsed.data;
}
