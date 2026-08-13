import { describe, expect, it, vi } from "vitest";
import {
  OpenClawReadAdapter,
  type OpenClawReadGateway,
  type OpenClawReadGatewayCallbacks,
  type OpenClawTelemetryEvent,
} from "./adapter.js";

const bindings = [
  {
    agentId: "agent_11111111-1111-1111-1111-111111111111",
    bindingId: "binding_22222222-2222-2222-2222-222222222222",
    externalAgentId: "researcher",
    displayName: "Research Lead",
  },
] as const;

function createHarness(overrides?: {
  agents?: unknown;
  sessions?: unknown;
  presence?: unknown;
  onSnapshot?: () => void | Promise<void>;
}) {
  let callbacks: OpenClawReadGatewayCallbacks | undefined;
  const telemetry: OpenClawTelemetryEvent[] = [];
  const snapshots: unknown[] = [];
  const gateway: OpenClawReadGateway = {
    start: vi.fn(),
    stopAndWait: vi.fn(async () => undefined),
    subscribeSessions: vi.fn(async () => undefined),
    listAgents: vi.fn(
      async () =>
        overrides?.agents ?? {
          defaultId: "researcher",
          mainKey: "agent:researcher:main",
          scope: "global",
          agents: [{ id: "researcher", kind: "agent" }],
        },
    ),
    listSessions: vi.fn(
      async () =>
        overrides?.sessions ?? {
          ts: 1_786_597_200_000,
          path: "/must-not-leak",
          count: 1,
          defaults: {},
          sessions: [
            {
              key: "agent:researcher:main",
              kind: "direct",
              updatedAt: 1_786_597_100_000,
              hasActiveRun: true,
              activeRunIds: ["runtime-run-7"],
            },
          ],
        },
    ),
    listPresence: vi.fn(
      async () =>
        overrides?.presence ?? [
          { mode: "gateway", reason: "self", text: "Gateway", ts: 1_786_597_200_000 },
        ],
    ),
  };
  const adapter = new OpenClawReadAdapter({
    config: {
      endpoint: "ws://127.0.0.1:18789",
      clientVersion: "0.0.0-test",
      instanceId: "adapter-test",
    },
    bindings,
    credentialProvider: async () => ({ kind: "TOKEN", value: "super-secret-token" }),
    gatewayFactory: (input) => {
      callbacks = input.callbacks;
      return gateway;
    },
    telemetry: { record: (event) => telemetry.push(event) },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
      return overrides?.onSnapshot?.();
    },
    now: () => new Date("2026-08-13T06:00:00.000Z"),
    correlationId: "corr-test",
  });

  return {
    adapter,
    gateway,
    telemetry,
    snapshots,
    get callbacks() {
      if (!callbacks) {
        throw new Error("Gateway callbacks are not initialized");
      }
      return callbacks;
    },
  };
}

const readHello = {
  protocol: 4,
  auth: { role: "operator", scopes: ["operator.read"] },
  snapshot: { stateVersion: { presence: 7, health: 3 } },
} as const;

describe("OpenClawReadAdapter", () => {
  it("subscribes before reading and emits one authoritative normalized snapshot", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);

    expect(harness.gateway.subscribeSessions).toHaveBeenCalledTimes(1);
    expect(harness.gateway.listAgents).toHaveBeenCalledTimes(1);
    expect(harness.gateway.listSessions).toHaveBeenCalledWith({
      configuredAgentsOnly: true,
      includeGlobal: false,
      includeUnknown: false,
      limit: 500,
    });
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]).toEqual(
      expect.objectContaining({
        sourceCursor: {
          connectionEpoch: 1,
          connectionSequence: null,
          stateVersion: { presence: 7, health: 3 },
        },
        runtime: expect.objectContaining({
          agents: [expect.objectContaining({ status: "RUNNING" })],
        }),
      }),
    );
    expect(harness.adapter.state).toBe("READY");
  });

  it("ignores duplicate events and resyncs on a forward sequence gap", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);

    await harness.callbacks.onEvent({
      type: "event",
      event: "sessions.changed",
      payload: { sessionKey: "agent:researcher:main" },
      seq: 1,
      stateVersion: { presence: 7, health: 3 },
    });
    await harness.callbacks.onEvent({
      type: "event",
      event: "sessions.changed",
      payload: { sessionKey: "agent:researcher:main" },
      seq: 1,
      stateVersion: { presence: 7, health: 3 },
    });
    await harness.callbacks.onEvent({
      type: "event",
      event: "agent",
      payload: { runId: "runtime-run-7", secret: "must-not-be-recorded" },
      seq: 3,
      stateVersion: { presence: 8, health: 3 },
    });

    expect(harness.gateway.listSessions).toHaveBeenCalledTimes(3);
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({
        event: "openclaw_event_ignored",
        reason: "DUPLICATE_OR_STALE",
        sequence: 1,
      }),
    );
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({
        event: "openclaw_sequence_gap",
        expectedSequence: 2,
        receivedSequence: 3,
      }),
    );
    expect(JSON.stringify(harness.telemetry)).not.toContain("must-not-be-recorded");
  });

  it("re-subscribes and resets the connection sequence on reconnect", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);
    await harness.callbacks.onEvent({
      type: "event",
      event: "presence",
      payload: [],
      seq: 1,
      stateVersion: { presence: 8, health: 3 },
    });
    await harness.callbacks.onHello(readHello);

    expect(harness.gateway.subscribeSessions).toHaveBeenCalledTimes(2);
    expect(harness.snapshots.at(-1)).toEqual(
      expect.objectContaining({
        sourceCursor: expect.objectContaining({
          connectionEpoch: 2,
          connectionSequence: null,
        }),
      }),
    );
  });

  it("publishes an offline projection after disconnect", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);
    await harness.callbacks.onClose({ phase: "post-hello", code: 1006 });

    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.snapshots.at(-1)).toEqual(
      expect.objectContaining({
        runtime: expect.objectContaining({
          agents: [expect.objectContaining({ status: "OFFLINE" })],
          sessions: [],
          presence: [],
        }),
      }),
    );
  });

  it("does not publish a late authoritative response after disconnect", async () => {
    const pendingAgents = Promise.withResolvers<unknown>();
    const harness = createHarness({ agents: pendingAgents.promise });
    await harness.adapter.start();
    const sync = harness.callbacks.onHello(readHello);
    await vi.waitFor(() => expect(harness.gateway.listAgents).toHaveBeenCalledTimes(1));

    await harness.callbacks.onClose({ phase: "post-hello", code: 1006 });
    pendingAgents.resolve({
      defaultId: "researcher",
      mainKey: "agent:researcher:main",
      scope: "global",
      agents: [{ id: "researcher", kind: "agent" }],
    });
    await sync;

    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]).toEqual(
      expect.objectContaining({
        runtime: expect.objectContaining({
          agents: [expect.objectContaining({ status: "OFFLINE" })],
        }),
      }),
    );
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({
        event: "openclaw_sync_completed",
        outcome: "STALE_CONNECTION",
      }),
    );
  });

  it("fails closed when the negotiated connection is over-privileged", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onHello({
      ...readHello,
      auth: { role: "operator", scopes: ["operator.read", "operator.admin"] },
    });

    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.gateway.stopAndWait).toHaveBeenCalledTimes(1);
    expect(harness.gateway.listAgents).not.toHaveBeenCalled();
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({
        event: "openclaw_sync_completed",
        outcome: "REJECTED_AUTHORITY",
      }),
    );
  });

  it("does not copy credential or upstream error text into telemetry", async () => {
    const harness = createHarness();
    await harness.adapter.start();
    await harness.callbacks.onConnectError(
      new Error("token=super-secret-token password=hunter2 session=agent:researcher:main"),
    );

    const serialized = JSON.stringify(harness.telemetry);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("agent:researcher:main");
    expect(serialized).toContain("openclaw_connection_error");
  });

  it("degrades safely when an authoritative response is malformed", async () => {
    const harness = createHarness({ agents: { agents: "not-an-array" } });
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);

    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.snapshots).toHaveLength(0);
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({
        event: "openclaw_sync_completed",
        outcome: "INVALID_RESPONSE",
      }),
    );
  });

  it("does not become ready until the authoritative snapshot is persisted", async () => {
    const persisted = Promise.withResolvers<void>();
    const harness = createHarness({ onSnapshot: () => persisted.promise });
    await harness.adapter.start();
    const hello = harness.callbacks.onHello(readHello);
    await vi.waitFor(() => expect(harness.snapshots).toHaveLength(1));
    expect(harness.adapter.state).toBe("SYNCING");
    persisted.resolve();
    await hello;
    expect(harness.adapter.state).toBe("READY");
  });

  it("degrades without publishing readiness when snapshot persistence fails", async () => {
    const harness = createHarness({
      onSnapshot: async () => {
        throw new Error("database unavailable");
      },
    });
    await harness.adapter.start();
    await harness.callbacks.onHello(readHello);
    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({ event: "openclaw_sync_completed", outcome: "READ_FAILED" }),
    );
  });

  it("serializes disconnect after an in-flight snapshot and never restores stale readiness", async () => {
    const firstPersisted = Promise.withResolvers<void>();
    const persistenceOrder: string[] = [];
    let snapshotNumber = 0;
    const harness = createHarness({
      onSnapshot: async () => {
        snapshotNumber += 1;
        const current = snapshotNumber;
        persistenceOrder.push(`start:${current}`);
        if (current === 1) await firstPersisted.promise;
        persistenceOrder.push(`finish:${current}`);
      },
    });
    await harness.adapter.start();
    const hello = harness.callbacks.onHello(readHello);
    await vi.waitFor(() => expect(persistenceOrder).toEqual(["start:1"]));
    const close = harness.callbacks.onClose({ phase: "post-hello", code: 1006 });
    expect(persistenceOrder).toEqual(["start:1"]);
    firstPersisted.resolve();
    await Promise.all([hello, close]);
    expect(persistenceOrder).toEqual(["start:1", "finish:1", "start:2", "finish:2"]);
    expect(harness.adapter.state).toBe("DEGRADED");
    expect(harness.telemetry).toContainEqual(
      expect.objectContaining({ event: "openclaw_sync_completed", outcome: "STALE_CONNECTION" }),
    );
  });

  it("waits for in-flight snapshot persistence before shutdown completes", async () => {
    const persisted = Promise.withResolvers<void>();
    const harness = createHarness({ onSnapshot: () => persisted.promise });
    await harness.adapter.start();
    const hello = harness.callbacks.onHello(readHello);
    await vi.waitFor(() => expect(harness.snapshots).toHaveLength(1));
    let stopped = false;
    const stop = harness.adapter.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    persisted.resolve();
    await Promise.all([hello, stop]);
    expect(stopped).toBe(true);
    expect(harness.adapter.state).toBe("STOPPED");
  });
});
