import { describe, expect, it } from "vitest";
import { ProjectionCursorSchema, WorldEventSchema } from "./index.js";

const UUID = "019ff96a-07fa-76a3-a020-9a32cf2d1a51";

describe("WorldEvent contract", () => {
  it("parses a sourced real Agent status event", () => {
    const event = WorldEventSchema.parse({
      schemaVersion: 1,
      id: `event_${UUID}`,
      sequence: 41,
      occurredAt: "2026-08-13T05:30:00.000Z",
      source: {
        kind: "RUNTIME",
        adapterKind: "OPENCLAW",
        bindingId: `binding_${UUID}`,
        externalEventId: "gateway-event-41",
      },
      eventType: "AGENT_STATUS_CHANGED",
      payload: {
        agentId: `agent_${UUID}`,
        status: "RUNNING",
        taskId: `task_${UUID}`,
        runId: `run_${UUID}`,
      },
    });

    expect(event.eventType).toBe("AGENT_STATUS_CHANGED");
    expect(event.source.kind).toBe("RUNTIME");
  });

  it("accepts canonical domain events with an idempotent command source", () => {
    const event = WorldEventSchema.parse({
      schemaVersion: 1,
      id: `event_${UUID}`,
      sequence: 42,
      occurredAt: "2026-08-13T05:30:01.000Z",
      source: {
        kind: "DOMAIN",
        actor: "OWNER",
        commandId: `command:${UUID}`,
      },
      eventType: "TASK_ASSIGNED",
      payload: {
        taskId: `task_${UUID}`,
        agentId: `agent_${UUID}`,
      },
    });

    expect(event.eventType).toBe("TASK_ASSIGNED");
    expect(event.source.kind).toBe("DOMAIN");
  });

  it("rejects simulation sources and synthetic narration fields", () => {
    const event = WorldEventSchema.safeParse({
      schemaVersion: 1,
      id: `event_${UUID}`,
      sequence: 43,
      occurredAt: "2026-08-13T05:30:02.000Z",
      source: {
        kind: "SIMULATION",
      },
      eventType: "AGENT_STATUS_CHANGED",
      payload: {
        agentId: `agent_${UUID}`,
        status: "RUNNING",
        narration: "Researcher is thinking very hard.",
      },
    });

    expect(event.success).toBe(false);
  });

  it("rejects invalid sequence and cross-identity payloads", () => {
    const event = WorldEventSchema.safeParse({
      schemaVersion: 1,
      id: `event_${UUID}`,
      sequence: -1,
      occurredAt: "2026-08-13T05:30:02.000Z",
      source: {
        kind: "DOMAIN",
        actor: "SYSTEM_POLICY",
        commandId: `command:${UUID}`,
      },
      eventType: "TASK_ASSIGNED",
      payload: {
        taskId: `task_${UUID}`,
        agentId: `account_${UUID}`,
      },
    });

    expect(event.success).toBe(false);
  });

  it("rejects control characters in external event identity", () => {
    const event = WorldEventSchema.safeParse({
      schemaVersion: 1,
      id: `event_${UUID}`,
      sequence: 44,
      occurredAt: "2026-08-13T05:30:03.000Z",
      source: {
        kind: "RUNTIME",
        adapterKind: "OPENCLAW",
        bindingId: `binding_${UUID}`,
        externalEventId: "gateway-event-44\nforged-log-line",
      },
      eventType: "AGENT_STATUS_CHANGED",
      payload: {
        agentId: `agent_${UUID}`,
        status: "IDLE",
      },
    });

    expect(event.success).toBe(false);
  });
});

describe("projection cursor contract", () => {
  it("supports the explicit initial cursor", () => {
    const cursor = ProjectionCursorSchema.parse({
      schemaVersion: 1,
      stream: "WORLD",
      lastSequence: 0,
    });

    expect(cursor.lastSequence).toBe(0);
  });

  it("requires an Event ID after the initial sequence", () => {
    const cursor = ProjectionCursorSchema.safeParse({
      schemaVersion: 1,
      stream: "WORLD",
      lastSequence: 41,
    });

    expect(cursor.success).toBe(false);
  });
});
