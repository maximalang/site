import { ContextCompilerInputSchema, ContextItemSchema } from "@agent-world/domain";
import { describe, expect, it } from "vitest";
import { compileContextPack } from "./context-compiler.js";

const projectId = "project_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";
const eventId = "event_33333333-3333-3333-3333-333333333333";

const input = ContextCompilerInputSchema.parse({
  schemaVersion: 1,
  packId: "context_pack_44444444-4444-4444-4444-444444444444",
  runId: "run_55555555-5555-5555-5555-555555555555",
  task: {
    schemaVersion: 1,
    id: "task_66666666-6666-6666-6666-666666666666",
    projectId,
    assigneeAgentId: agentId,
    title: "Use canonical project state",
    approvalRequirement: "NOT_REQUIRED",
    idempotencyKey: "context:project-state-boundary",
    createdAt: "2026-08-19T09:00:00.000Z",
  },
  agent: {
    schemaVersion: 1,
    id: agentId,
    slug: "builder",
    displayName: "Builder",
    role: "Implementation",
    instructions: "Use only canonical project state.",
    isEnabled: true,
  },
  project: {
    id: projectId,
    name: "AI World",
    state: "Newest canonical project state.",
  },
  route: {
    schemaVersion: 1,
    id: "route_77777777-7777-7777-7777-777777777777",
    label: "Codex",
    mode: "CODEX",
    adapterKind: "CODEX",
    accountId: "account_88888888-8888-8888-8888-888888888888",
    isEnabled: true,
  },
  tokenBudget: 1_200,
  expectedOutput: "Verified result.",
  handoffContract: "Preserve verified state.",
  availableTools: [],
});

describe("ContextPack project state boundary", () => {
  it("never appends PROJECT_STATE candidates to the canonical project state section", () => {
    const staleProjectState = ContextItemSchema.parse({
      schemaVersion: 1,
      id: "context_item_99999999-9999-9999-9999-999999999999",
      projectId,
      kind: "PROJECT_STATE",
      temperature: "HOT",
      content: "Older but highly relevant project state.",
      contentHash: "9".repeat(64),
      estimatedTokens: 10,
      importance: 1,
      provenance: { kind: "DOMAIN_EVENT", eventId },
      createdAt: "2026-08-19T08:00:00.000Z",
    });
    const memory = ContextItemSchema.parse({
      schemaVersion: 1,
      id: "context_item_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectId,
      kind: "MEMORY",
      temperature: "COLD",
      content: "Independent supporting memory.",
      contentHash: "a".repeat(64),
      estimatedTokens: 8,
      importance: 0.2,
      provenance: { kind: "DOMAIN_EVENT", eventId },
      createdAt: "2026-08-19T08:30:00.000Z",
    });

    const pack = compileContextPack(
      input,
      [
        { item: staleProjectState, relevance: 1 },
        { item: memory, relevance: 0.1 },
      ],
      "2026-08-19T10:00:00.000Z",
    );
    const projectState =
      pack.sections.find(({ name }) => name === "CURRENT_PROJECT_STATE")?.content ?? "";

    expect(pack.compilerVersion).toBe("1.3.6");
    expect(projectState).toBe("Project: AI World\nNewest canonical project state.");
    expect(projectState).not.toContain(staleProjectState.content);
    expect(pack.evidence.map(({ contextItemId }) => contextItemId)).toEqual([memory.id]);
  });
});
