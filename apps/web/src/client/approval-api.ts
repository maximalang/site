import {
  type ApprovalDecisionResponse,
  ApprovalDecisionResponseSchema,
} from "@agent-world/read-model";
import { ConversationApiError } from "./conversation-api";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ApprovalDecisionClientInput = {
  taskId: string;
  decisionId: string;
  csrfToken: string;
} & ({ decision: "APPROVE" } | { decision: "DENY" | "REVOKE"; reason: string });

export async function decideApproval(
  input: ApprovalDecisionClientInput,
  fetcher: Fetcher = fetch,
): Promise<ApprovalDecisionResponse> {
  const response = await fetcher("/api/approvals", {
    body: JSON.stringify({
      schemaVersion: 1,
      taskId: input.taskId,
      decisionId: input.decisionId,
      decision: input.decision,
      ...(input.decision === "APPROVE" ? {} : { reason: input.reason }),
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
    let code = "APPROVAL_DECISION_UNAVAILABLE";
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
  const parsed = ApprovalDecisionResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid approval decision response");
  return parsed.data;
}
