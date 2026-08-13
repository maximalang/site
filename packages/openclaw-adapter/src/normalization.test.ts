import { describe, expect, it } from "vitest";
import {
  normalizeOpenClawSnapshot,
  OpenClawAgentsListResultSchema,
  OpenClawSessionsListResultSchema,
} from "./normalization.js";

const bindings = [
  {
    agentId: "agent_11111111-1111-1111-1111-111111111111",
    bindingId: "binding_22222222-2222-2222-2222-222222222222",
    externalAgentId: "researcher",
    displayName: "Research Lead",
  },
  {
    agentId: "agent_33333333-3333-3333-3333-333333333333",
    bindingId: "binding_44444444-4444-4444-4444-444444444444",
    externalAgentId: "writer",
    displayName: "Writer",
  },
] as const;

describe("normalizeOpenClawSnapshot", () => {
  it("keeps canonical Agent identity separate from OpenClaw identity", () => {
    const snapshot = normalizeOpenClawSnapshot({
      bindings,
      receivedAt: "2026-08-13T06:00:00.000Z",
      agents: {
        defaultId: "researcher",
        mainKey: "agent:researcher:main",
        scope: "per-sender",
        agents: [
          { id: "researcher", kind: "agent", name: "Upstream name" },
          { id: "unbound", kind: "agent", name: "Must not become canonical" },
        ],
      },
      sessions: {
        ts: 1_786_597_200_000,
        path: "/redacted/by-adapter",
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
      presence: [{ mode: "gateway", reason: "self", text: "Gateway", ts: 1_786_597_200_000 }],
    });

    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        agentId: bindings[0].agentId,
        externalAgentId: "researcher",
        displayName: "Research Lead",
        status: "RUNNING",
      }),
      expect.objectContaining({
        agentId: bindings[1].agentId,
        externalAgentId: "writer",
        displayName: "Writer",
        status: "OFFLINE",
      }),
    ]);
    expect(snapshot.agents.some((agent) => agent.externalAgentId === "unbound")).toBe(false);
    expect(snapshot.sessions[0]).toEqual(
      expect.objectContaining({
        agentId: bindings[0].agentId,
        externalSessionKey: "agent:researcher:main",
      }),
    );
  });

  it("maps terminal failures without treating killed sessions as active failures", () => {
    const snapshot = normalizeOpenClawSnapshot({
      bindings,
      receivedAt: "2026-08-13T06:00:00.000Z",
      agents: {
        defaultId: "researcher",
        mainKey: "agent:researcher:main",
        scope: "global",
        agents: [
          { id: "researcher", kind: "agent" },
          { id: "writer", kind: "agent" },
        ],
      },
      sessions: {
        ts: 1_786_597_200_000,
        path: "/ignored",
        count: 2,
        defaults: {},
        sessions: [
          {
            key: "agent:researcher:main",
            kind: "direct",
            updatedAt: 1_786_597_100_000,
            status: "failed",
          },
          {
            key: "agent:writer:main",
            kind: "direct",
            updatedAt: 1_786_597_150_000,
            status: "killed",
          },
        ],
      },
      presence: [],
    });

    expect(snapshot.agents.map(({ externalAgentId, status }) => [externalAgentId, status])).toEqual(
      [
        ["researcher", "FAILED"],
        ["writer", "IDLE"],
      ],
    );
  });

  it("rejects duplicate bindings for one external OpenClaw Agent", () => {
    expect(() =>
      normalizeOpenClawSnapshot({
        bindings: [bindings[0], { ...bindings[1], externalAgentId: "researcher" }],
        receivedAt: "2026-08-13T06:00:00.000Z",
        agents: {
          defaultId: "researcher",
          mainKey: "agent:researcher:main",
          scope: "global",
          agents: [{ id: "researcher", kind: "agent" }],
        },
        sessions: { ts: 1, path: "/ignored", count: 0, defaults: {}, sessions: [] },
        presence: [],
      }),
    ).toThrow("Duplicate OpenClaw externalAgentId");
  });
});

describe("pinned OpenClaw response contracts", () => {
  it("strips additive upstream fields but rejects malformed required fields", () => {
    const agents = OpenClawAgentsListResultSchema.parse({
      defaultId: "main",
      mainKey: "agent:main:main",
      scope: "global",
      futureField: "ignored",
      agents: [{ id: "main", kind: "agent", futureField: "ignored" }],
    });

    expect(agents).toEqual({
      defaultId: "main",
      mainKey: "agent:main:main",
      scope: "global",
      agents: [{ id: "main", kind: "agent" }],
    });
    expect(
      OpenClawAgentsListResultSchema.safeParse({
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "global",
        agents: [{ id: "main", kind: "invented" }],
      }).success,
    ).toBe(false);
  });

  it("bounds session results and rejects unsafe external identifiers", () => {
    expect(
      OpenClawSessionsListResultSchema.safeParse({
        ts: 1,
        path: "/ignored",
        count: 1,
        defaults: {},
        sessions: [{ key: "agent:main:bad\u0000key", kind: "direct", updatedAt: 1 }],
      }).success,
    ).toBe(false);

    expect(
      OpenClawSessionsListResultSchema.safeParse({
        ts: 1,
        path: "/ignored",
        count: 1_001,
        defaults: {},
        sessions: Array.from({ length: 1_001 }, (_, index) => ({
          key: `agent:main:${index}`,
          kind: "direct",
          updatedAt: index,
        })),
      }).success,
    ).toBe(false);
  });
});
