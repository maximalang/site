import { buildWorldReadModel, type WorldReadModel } from "@agent-world/read-model";

export function buildContractFixture(generatedAt = "2026-08-13T06:00:04.000Z"): WorldReadModel {
  return buildWorldReadModel({
    source: "CONTRACT_FIXTURE",
    generatedAt,
    agents: [
      {
        schemaVersion: 1,
        id: "agent_11111111-1111-1111-1111-111111111111",
        slug: "researcher",
        displayName: "Research Lead",
        role: "Evidence-first research",
        instructions: "Find sources and preserve provenance.",
        isEnabled: true,
      },
      {
        schemaVersion: 1,
        id: "agent_22222222-2222-2222-2222-222222222222",
        slug: "reviewer",
        displayName: "Reviewer",
        role: "Independent review",
        instructions: "Review claims against primary sources.",
        isEnabled: true,
      },
    ],
    tasks: [
      {
        schemaVersion: 1,
        id: "task_44444444-4444-4444-4444-444444444444",
        projectId: "project_33333333-3333-3333-3333-333333333333",
        assigneeAgentId: "agent_11111111-1111-1111-1111-111111111111",
        title: "Verify protocol contract",
        approvalRequirement: "NOT_REQUIRED",
        idempotencyKey: "task:create:protocol-contract",
        createdAt: "2026-08-13T06:00:00.000Z",
      },
    ],
    events: [
      {
        schemaVersion: 1,
        id: "event_55555555-5555-5555-5555-555555555555",
        sequence: 1,
        occurredAt: "2026-08-13T06:00:01.000Z",
        source: { kind: "DOMAIN", actor: "OWNER", commandId: "task:assign:protocol-contract" },
        eventType: "TASK_ASSIGNED",
        payload: {
          taskId: "task_44444444-4444-4444-4444-444444444444",
          agentId: "agent_11111111-1111-1111-1111-111111111111",
        },
      },
      {
        schemaVersion: 1,
        id: "event_66666666-6666-6666-6666-666666666666",
        sequence: 2,
        occurredAt: "2026-08-13T06:00:02.000Z",
        source: {
          kind: "RUNTIME",
          adapterKind: "OPENCLAW",
          bindingId: "binding_88888888-8888-8888-8888-888888888888",
          externalEventId: "fixture-event-2",
        },
        eventType: "AGENT_STATUS_CHANGED",
        payload: {
          agentId: "agent_11111111-1111-1111-1111-111111111111",
          status: "RUNNING",
          taskId: "task_44444444-4444-4444-4444-444444444444",
        },
      },
      {
        schemaVersion: 1,
        id: "event_77777777-7777-7777-7777-777777777777",
        sequence: 3,
        occurredAt: "2026-08-13T06:00:03.000Z",
        source: {
          kind: "RUNTIME",
          adapterKind: "OPENCLAW",
          bindingId: "binding_99999999-9999-9999-9999-999999999999",
          externalEventId: "fixture-event-3",
        },
        eventType: "AGENT_STATUS_CHANGED",
        payload: {
          agentId: "agent_22222222-2222-2222-2222-222222222222",
          status: "IDLE",
        },
      },
    ],
  });
}
