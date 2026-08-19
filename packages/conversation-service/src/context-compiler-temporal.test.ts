import { ContextCompilerInputSchema, ContextItemSchema } from "@agent-world/domain";
import { describe, expect, it } from "vitest";
import { compileContextPack } from "./context-compiler.js";

const projectId = "project_11111111-1111-1111-1111-111111111111";
const agentId = "agent_22222222-2222-2222-2222-222222222222";
const eventId = "event_33333333-3333-3333-3333-333333333333";
const compiledAt = "2026-08-19T10:00:00.000Z";

const input = ContextCompilerInputSchema.parse({
  schemaVersion: 1,
  packId: "context_pack_44444444-4444-4444-4444-444444444444",
  runId: "run_55555555-5555-5555-5555-555555555555",
  task: {
    schemaVersion: 1,
    id: "task_66666666-6666-6666-6666-666666666666",
    projectId,
    assigneeAgentId: agentId,
    title: "Compile a temporal snapshot",
    approvalRequirement: "NOT_REQUIRED",
    idempotencyKey: "context:temporal-snapshot",
    createdAt: "2026-08-19T09:00:00.000Z",
  },
  agent: {
    schemaVersion: 1,
    id: agentId,
    slug: "builder",
    displayName: "Builder",
    role: "Implementation",
    instructions: "Never use evidence from the future.",
    isEnabled: true,
  },
  project: {
    id: projectId,
    name: "AI World",
    state: "Canonical state at compilation time.",
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
  handoffContract: "Preserve snapshot provenance.",
  availableTools: [],
});

function memory(id: string, content: string, createdAt: string) {
  return ContextItemSchema.parse({
    schemaVersion: 1,
    id,
    projectId,
    kind: "MEMORY",
    temperature: "WARM",
    content,
    contentHash: id.includes("aaaa") ? "a".repeat(64) : "b".repeat(64),
    estimatedTokens: 8,
    importance: 0.5,
    provenance: { kind: "DOMAIN_EVENT", eventId },
    createdAt,
  });
}

describe("ContextPack temporal snapshot", () => {
  it("excludes candidates created after compiledAt even when they rank first", () => {
    const active = memory(
      "context_item_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "Known at compilation time.",
      "2026-08-19T09:59:59.000Z",
    );
    const future = memory(
      "context_item_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "Not known until after compilation.",
      "2026-08-19T10:00:01.000Z",
    );

    const pack = compileContextPack(
      input,
      [
        { item: future, relevance: 1 },
        { item: active, relevance: 0.1 },
      ],
      compiledAt,
    );

    expect(pack.compilerVersion).toBe("1.3.7");
    expect(pack.evidence.map(({ contextItemId }) => contextItemId)).toEqual([active.id]);
    expect(pack.rendered).toContain(active.content);
    expect(pack.rendered).not.toContain(future.content);
  });
});
