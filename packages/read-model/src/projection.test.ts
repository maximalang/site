import { describe, expect, it } from "vitest";
import {
  buildLiveRuntimeWorldReadModel,
  buildUnavailableWorldReadModel,
  buildWorldReadModel,
  projectCommandView,
  projectWorldView,
  WorldReadModelSchema,
} from "./projection.js";

const ids = {
  researcher: "agent_11111111-1111-1111-1111-111111111111",
  reviewer: "agent_22222222-2222-2222-2222-222222222222",
  project: "project_33333333-3333-3333-3333-333333333333",
  task: "task_44444444-4444-4444-4444-444444444444",
  event1: "event_55555555-5555-5555-5555-555555555555",
  event2: "event_66666666-6666-6666-6666-666666666666",
  event3: "event_77777777-7777-7777-7777-777777777777",
  binding: "binding_88888888-8888-8888-8888-888888888888",
  task2: "task_99999999-9999-4999-8999-999999999999",
  mission: "mission_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  run: "run_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

const agents = [
  {
    schemaVersion: 1,
    id: ids.researcher,
    slug: "researcher",
    displayName: "Research Lead",
    role: "Evidence-first research",
    instructions: "Find sources and preserve provenance.",
    isEnabled: true,
  },
  {
    schemaVersion: 1,
    id: ids.reviewer,
    slug: "reviewer",
    displayName: "Reviewer",
    role: "Independent review",
    instructions: "Review claims against primary sources.",
    isEnabled: true,
  },
] as const;

const tasks = [
  {
    schemaVersion: 1,
    id: ids.task,
    projectId: ids.project,
    assigneeAgentId: ids.researcher,
    title: "Verify protocol contract",
    approvalRequirement: "NOT_REQUIRED",
    idempotencyKey: "task:create:protocol-contract",
    createdAt: "2026-08-13T06:00:00.000Z",
  },
] as const;

const events = [
  {
    schemaVersion: 1,
    id: ids.event1,
    sequence: 1,
    occurredAt: "2026-08-13T06:00:01.000Z",
    source: {
      kind: "DOMAIN",
      actor: "OWNER",
      commandId: "task:assign:protocol-contract",
    },
    eventType: "TASK_ASSIGNED",
    payload: { taskId: ids.task, agentId: ids.researcher },
  },
  {
    schemaVersion: 1,
    id: ids.event2,
    sequence: 2,
    occurredAt: "2026-08-13T06:00:02.000Z",
    source: {
      kind: "RUNTIME",
      adapterKind: "OPENCLAW",
      bindingId: ids.binding,
      externalEventId: "openclaw-event-2",
    },
    eventType: "AGENT_STATUS_CHANGED",
    payload: {
      agentId: ids.researcher,
      status: "RUNNING",
      taskId: ids.task,
    },
  },
  {
    schemaVersion: 1,
    id: ids.event3,
    sequence: 3,
    occurredAt: "2026-08-13T06:00:03.000Z",
    source: {
      kind: "RUNTIME",
      adapterKind: "OPENCLAW",
      bindingId: ids.binding,
      externalEventId: "openclaw-event-3",
    },
    eventType: "AGENT_STATUS_CHANGED",
    payload: { agentId: ids.reviewer, status: "IDLE" },
  },
] as const;

function buildFixture() {
  return buildWorldReadModel({
    source: "CONTRACT_FIXTURE",
    generatedAt: "2026-08-13T06:00:04.000Z",
    agents,
    tasks,
    events,
  });
}

describe("buildWorldReadModel", () => {
  it("replays canonical events into a strict deterministic read model", () => {
    const model = buildFixture();

    expect(WorldReadModelSchema.parse(model)).toEqual(model);
    expect(model.cursor).toEqual({
      schemaVersion: 1,
      stream: "WORLD",
      lastSequence: 3,
      lastEventId: ids.event3,
    });
    expect(model.agents).toEqual([
      expect.objectContaining({
        agentId: ids.researcher,
        status: "RUNNING",
        currentTask: expect.objectContaining({ taskId: ids.task }),
        world: expect.objectContaining({ zone: "WORK_ROOM" }),
      }),
      expect.objectContaining({
        agentId: ids.reviewer,
        status: "IDLE",
        world: expect.objectContaining({ zone: "AGENT_HALL" }),
      }),
    ]);
    expect(JSON.stringify(model)).not.toContain("openclaw-event-2");
    expect(JSON.stringify(model)).not.toContain("instructions");
    expect(JSON.stringify(model)).not.toContain("externalAgentId");
    expect(() =>
      WorldReadModelSchema.parse({
        ...model,
        agents: [{ ...model.agents[0], externalAgentId: "researcher" }, ...model.agents.slice(1)],
      }),
    ).toThrow();
  });

  it("gives World and Command the exact same cursor and Agent/status/task identity", () => {
    const model = buildFixture();
    const world = projectWorldView(model);
    const command = projectCommandView(model);

    expect(world.cursor).toEqual(command.cursor);
    expect(world.agents.map(({ core }) => core)).toEqual(command.agents.map(({ core }) => core));
  });

  it("projects a bounded canonical handoff without runtime or Account identity", () => {
    const model = buildWorldReadModel({
      source: "LIVE",
      generatedAt: "2026-08-13T06:00:04.000Z",
      agents,
      tasks: [
        ...tasks,
        {
          ...tasks[0],
          id: ids.task2,
          assigneeAgentId: ids.reviewer,
          title: "Review protocol evidence",
          idempotencyKey: "task:create:protocol-review",
        },
      ],
      events,
      handoffs: [
        {
          id: "event_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          missionId: ids.mission,
          fromTaskId: ids.task,
          toTaskId: ids.task2,
          fromRunId: ids.run,
          fromAgentId: ids.researcher,
          toAgentId: ids.reviewer,
          occurredAt: "2026-08-13T06:00:03.500Z",
        },
      ],
    });
    expect(projectWorldView(model).handoffs).toEqual(model.handoffs);
    expect(model.handoffs[0]).toMatchObject({
      fromAgentId: ids.researcher,
      toAgentId: ids.reviewer,
      fromRunId: ids.run,
    });
    expect(JSON.stringify(model.handoffs)).not.toMatch(/account_|binding_|session_/);
  });

  it("rejects gaps, duplicate order and references outside the canonical input", () => {
    expect(() =>
      buildWorldReadModel({
        source: "LIVE",
        generatedAt: "2026-08-13T06:00:04.000Z",
        agents,
        tasks,
        events: [events[0], { ...events[2], sequence: 3 }],
      }),
    ).toThrow("contiguous");

    expect(() =>
      buildWorldReadModel({
        source: "LIVE",
        generatedAt: "2026-08-13T06:00:04.000Z",
        agents,
        tasks,
        events: [
          {
            ...events[0],
            payload: {
              ...events[0].payload,
              agentId: "agent_99999999-9999-9999-9999-999999999999",
            },
          },
        ],
      }),
    ).toThrow("unknown Agent");
  });

  it("projects live runtime statuses onto canonical Agents without runtime identities", () => {
    const model = buildLiveRuntimeWorldReadModel({
      generatedAt: "2026-08-13T10:00:00.000Z",
      cursor: {
        schemaVersion: 1,
        stream: "WORLD",
        lastSequence: 1,
        lastEventId: "event_99999999-9999-9999-9999-999999999999",
      },
      agents,
      runtimeStatuses: [
        { agentId: ids.researcher, status: "RUNNING" },
        { agentId: ids.reviewer, status: "FAILED" },
      ],
    });

    expect(model.source).toBe("LIVE");
    expect(
      model.agents.map(({ agentId, status, world }) => ({
        agentId,
        status,
        zone: world.zone,
      })),
    ).toEqual([
      { agentId: ids.researcher, status: "RUNNING", zone: "WORK_ROOM" },
      { agentId: ids.reviewer, status: "FAILED", zone: "CONTROL_TOWER" },
    ]);
    expect(JSON.stringify(model)).not.toMatch(/binding_|session_|external/);
  });

  it("rejects duplicate or unknown runtime Agent status identities", () => {
    const base = {
      generatedAt: "2026-08-13T10:00:00.000Z",
      cursor: { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
      agents,
    };
    expect(() =>
      buildLiveRuntimeWorldReadModel({
        ...base,
        runtimeStatuses: [
          { agentId: ids.researcher, status: "IDLE" },
          { agentId: ids.researcher, status: "RUNNING" },
        ],
      }),
    ).toThrow("Duplicate runtime Agent status");
    expect(() =>
      buildLiveRuntimeWorldReadModel({
        ...base,
        runtimeStatuses: [
          { agentId: "agent_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "IDLE" },
        ],
      }),
    ).toThrow("unknown Agent");
  });

  it("does not fabricate product objects when the source is unavailable", () => {
    const model = buildUnavailableWorldReadModel("2026-08-13T06:00:04.000Z");

    expect(model).toEqual({
      schemaVersion: 1,
      source: "UNAVAILABLE",
      generatedAt: "2026-08-13T06:00:04.000Z",
      cursor: { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
      agents: [],
      tasks: [],
      handoffs: [],
    });
    expect(() => WorldReadModelSchema.parse({ ...model, agents: [{}] })).toThrow();
  });
});
