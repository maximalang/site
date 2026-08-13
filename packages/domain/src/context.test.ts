import { describe, expect, it } from "vitest";
import {
  ContextCompilerInputSchema,
  ContextItemSchema,
  ContextPackSchema,
  StructuredAgentOutputSchema,
} from "./context.js";

const ids = {
  account: "account_11111111-1111-1111-1111-111111111111",
  agent: "agent_22222222-2222-2222-2222-222222222222",
  contextItem: "context_item_33333333-3333-3333-3333-333333333333",
  event: "event_44444444-4444-4444-4444-444444444444",
  pack: "context_pack_55555555-5555-5555-5555-555555555555",
  project: "project_66666666-6666-6666-6666-666666666666",
  route: "route_77777777-7777-7777-7777-777777777777",
  run: "run_88888888-8888-8888-8888-888888888888",
  task: "task_99999999-9999-9999-9999-999999999999",
} as const;

describe("shared context contracts", () => {
  it("requires exact provenance and bounded project-scoped context", () => {
    const value = ContextItemSchema.parse({
      schemaVersion: 1,
      id: ids.contextItem,
      projectId: ids.project,
      kind: "DECISION",
      temperature: "WARM",
      content: "Use PostgreSQL as the canonical source of truth.",
      summary: "PostgreSQL is canonical.",
      contentHash: "a".repeat(64),
      estimatedTokens: 12,
      importance: 0.9,
      provenance: { kind: "DOMAIN_EVENT", eventId: ids.event },
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    expect(value.projectId).toBe(ids.project);
    expect(() =>
      ContextItemSchema.parse({ ...value, provenance: { kind: "DOMAIN_EVENT" } }),
    ).toThrow();
    expect(() => ContextItemSchema.parse({ ...value, contentHash: "not-a-hash" })).toThrow();
  });

  it("accepts structured handoff fields while bounding untrusted model output", () => {
    const value = StructuredAgentOutputSchema.parse({
      schemaVersion: 1,
      fullOutput: "Full evidence.",
      summary: "Evidence checked.",
      findings: ["The migration is additive."],
      decisions: ["Keep one canonical database."],
      actions: ["Ran the isolated verifier."],
      artifacts: [],
      openQuestions: [],
      nextActions: ["Compile the next ContextPack."],
      memoryCandidates: [
        { statement: "PostgreSQL is canonical.", confidence: 0.99, importance: 0.9 },
      ],
      confidence: 0.95,
    });

    expect(value.memoryCandidates).toHaveLength(1);
    expect(() =>
      StructuredAgentOutputSchema.parse({
        ...value,
        findings: Array.from({ length: 101 }, () => "x"),
      }),
    ).toThrow();
    expect(() => StructuredAgentOutputSchema.parse({ ...value, confidence: 1.1 })).toThrow();
  });

  it("requires task, agent, project, route and an explicit token budget", () => {
    const value = ContextCompilerInputSchema.parse({
      schemaVersion: 1,
      packId: ids.pack,
      runId: ids.run,
      task: {
        schemaVersion: 1,
        id: ids.task,
        projectId: ids.project,
        assigneeAgentId: ids.agent,
        title: "Implement shared context",
        approvalRequirement: "NOT_REQUIRED",
        idempotencyKey: "context:compile-1",
        createdAt: "2026-08-14T10:00:00.000Z",
      },
      agent: {
        schemaVersion: 1,
        id: ids.agent,
        slug: "architect",
        displayName: "Architect",
        role: "System architect",
        instructions: "Preserve canonical state and provenance.",
        isEnabled: true,
      },
      project: { id: ids.project, name: "Agent World", state: "Phase 5 in progress." },
      route: {
        schemaVersion: 1,
        id: ids.route,
        label: "Codex account one",
        mode: "CODEX",
        adapterKind: "CODEX",
        accountId: ids.account,
        isEnabled: true,
      },
      tokenBudget: 4_096,
      expectedOutput: "A verified implementation and evidence.",
      handoffContract: "Return structured findings and next actions.",
      availableTools: ["shell", "apply_patch"],
    });

    expect(value.tokenBudget).toBe(4_096);
    expect(() => ContextCompilerInputSchema.parse({ ...value, tokenBudget: 255 })).toThrow();
    expect(() =>
      ContextCompilerInputSchema.parse({
        ...value,
        task: { ...value.task, projectId: "project_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      }),
    ).toThrow();
  });

  it("rejects missing, duplicate or reordered ContextPack sections", () => {
    const base = {
      schemaVersion: 1,
      compilerVersion: "1.0.0",
      id: ids.pack,
      runId: ids.run,
      taskId: ids.task,
      agentId: ids.agent,
      projectId: ids.project,
      routeId: ids.route,
      tokenBudget: 4_096,
      estimatedTokens: 90,
      contentHash: "b".repeat(64),
      compiledAt: "2026-08-14T10:00:00.000Z",
      rendered: "GOAL\nImplement shared context.",
      evidence: [],
    } as const;
    const names = [
      "GOAL",
      "CURRENT_PROJECT_STATE",
      "RELEVANT_DECISIONS",
      "RELEVANT_MEMORY",
      "RELEVANT_FINDINGS",
      "REQUIRED_SKILLS",
      "AVAILABLE_TOOLS",
      "ARTIFACT_REFERENCES",
      "EXPECTED_OUTPUT",
      "HANDOFF_CONTRACT",
    ] as const;
    const sections = names.map((name) => ({ name, content: "None." }));

    expect(ContextPackSchema.parse({ ...base, sections }).sections).toHaveLength(10);
    expect(() => ContextPackSchema.parse({ ...base, sections: sections.toReversed() })).toThrow();
    expect(() => ContextPackSchema.parse({ ...base, sections: sections.slice(1) })).toThrow();
    expect(() => ContextPackSchema.parse({ ...base, estimatedTokens: 4_097, sections })).toThrow();
  });
});
