import { MemoryCurationDecisionInputSchema } from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { loadMemoryView, submitMemoryDecision } from "./memory-api";

const projectId = "project_11111111-1111-1111-1111-111111111111";

describe("memory API client", () => {
  it("loads a no-store project-scoped view", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ schemaVersion: 1, projectId, proposals: [] }),
    );
    expect(await loadMemoryView(projectId, "INBOX", fetcher)).toMatchObject({ projectId });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/memory?projectId=${encodeURIComponent(projectId)}&view=INBOX`,
      { cache: "no-store", credentials: "same-origin" },
    );
  });

  it("sends only the decision input and in-memory CSRF", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ outcome: "CREATED" }),
    );
    await submitMemoryDecision(
      MemoryCurationDecisionInputSchema.parse({
        schemaVersion: 1,
        id: "memory_decision_22222222-2222-2222-2222-222222222222",
        proposalId: "memory_proposal_33333333-3333-3333-3333-333333333333",
        projectId,
        action: "REJECT",
        idempotencyKey: "memory:reject-test",
      }),
      "csrf-token",
      fetcher,
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "x-agent-world-csrf": "csrf-token" });
    expect(String(init?.body)).not.toContain("decidedAt");
  });
});
