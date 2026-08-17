import { describe, expect, it } from "vitest";
import { selectResourceRoute } from "./resource-broker.js";

const UUIDS = {
  chat: "11111111-1111-1111-1111-111111111111",
  codex: "22222222-2222-2222-2222-222222222222",
  account: "33333333-3333-3333-3333-333333333333",
};

const observedAt = "2026-08-14T10:00:00.000Z";
const expiresAt = "2026-08-14T10:05:00.000Z";

describe("selectResourceRoute", () => {
  it("returns an explicit empty decision when no observed route is eligible", () => {
    const decision = selectResourceRoute({
      policy: {
        version: "resource-broker-v1",
        weights: { quality: 0.2, remainingLimits: 0.2, cost: 0.2, speed: 0.2, load: 0.2 },
      },
      now: "2026-08-14T10:01:00.000Z",
      candidates: [],
    });

    expect(decision.evaluations).toEqual([]);
    expect(decision.selected).toBeUndefined();
  });

  it("excludes experimental Native Chat until live evidence enables the transport", () => {
    const decision = selectResourceRoute({
      policy: {
        version: "resource-broker-v1",
        weights: { quality: 0.4, remainingLimits: 0.3, cost: 0.1, speed: 0.1, load: 0.1 },
      },
      now: "2026-08-14T10:01:00.000Z",
      candidates: [
        {
          routeId: `route_${UUIDS.chat}`,
          accountId: `account_${UUIDS.account}`,
          mode: "CHAT",
          adapterKind: "NATIVE_CHATGPT",
          isAvailable: true,
          quality: 0.95,
          remainingLimits: 0.8,
          cost: 1,
          speed: 0.6,
          load: 0.7,
          observedAt,
          expiresAt,
        },
        {
          routeId: `route_${UUIDS.codex}`,
          accountId: `account_${UUIDS.account}`,
          mode: "CODEX",
          adapterKind: "CODEX",
          isAvailable: true,
          quality: 0.9,
          remainingLimits: 0.3,
          cost: 0.7,
          speed: 0.8,
          load: 0.9,
          observedAt,
          expiresAt,
        },
      ],
    });

    expect(decision.selected?.routeId).toBe(`route_${UUIDS.codex}`);
    expect(decision.evaluations).toHaveLength(2);
    expect(decision.evaluations[0]).toMatchObject({
      transportSupportStatus: "EXPERIMENTAL",
      exclusion: "TRANSPORT_NOT_SELECTABLE",
    });
    expect(decision.evaluations[1]?.score).toBe(0.69);
  });

  it("fails closed on stale or unavailable evidence", () => {
    const decision = selectResourceRoute({
      policy: {
        version: "resource-broker-v1",
        weights: { quality: 0.2, remainingLimits: 0.2, cost: 0.2, speed: 0.2, load: 0.2 },
      },
      now: "2026-08-14T10:06:00.000Z",
      candidates: [
        {
          routeId: `route_${UUIDS.chat}`,
          mode: "CHAT",
          adapterKind: "OPENCLAW",
          isAvailable: true,
          quality: 1,
          remainingLimits: 1,
          cost: 1,
          speed: 1,
          load: 1,
          observedAt,
          expiresAt,
        },
        {
          routeId: `route_${UUIDS.codex}`,
          accountId: `account_${UUIDS.account}`,
          mode: "CODEX",
          adapterKind: "CODEX",
          isAvailable: false,
          quality: 1,
          remainingLimits: 1,
          cost: 1,
          speed: 1,
          load: 1,
          observedAt,
          expiresAt: "2026-08-14T10:10:00.000Z",
        },
      ],
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.evaluations.map(({ exclusion }) => exclusion)).toEqual([
      "STALE_OBSERVATION",
      "UNAVAILABLE",
    ]);
  });

  it("uses canonical route identity as a deterministic tie-break", () => {
    const common = {
      accountId: `account_${UUIDS.account}`,
      mode: "CODEX" as const,
      adapterKind: "CODEX" as const,
      isAvailable: true,
      quality: 0.8,
      remainingLimits: 0.8,
      cost: 0.8,
      speed: 0.8,
      load: 0.8,
      observedAt,
      expiresAt,
    };
    const decision = selectResourceRoute({
      policy: {
        version: "resource-broker-v1",
        weights: { quality: 0.2, remainingLimits: 0.2, cost: 0.2, speed: 0.2, load: 0.2 },
      },
      now: "2026-08-14T10:01:00.000Z",
      candidates: [
        { ...common, routeId: `route_${UUIDS.codex}` },
        { ...common, routeId: `route_${UUIDS.chat}` },
      ],
    });

    expect(decision.selected?.routeId).toBe(`route_${UUIDS.chat}`);
  });

  it("records Native Work as unsupported instead of scoring it", () => {
    const decision = selectResourceRoute({
      policy: {
        version: "resource-broker-v1",
        weights: { quality: 0.2, remainingLimits: 0.2, cost: 0.2, speed: 0.2, load: 0.2 },
      },
      now: "2026-08-14T10:01:00.000Z",
      candidates: [
        {
          routeId: `route_${UUIDS.chat}`,
          accountId: `account_${UUIDS.account}`,
          mode: "WORK",
          adapterKind: "NATIVE_WORK",
          isAvailable: true,
          quality: 1,
          remainingLimits: 1,
          cost: 1,
          speed: 1,
          load: 1,
          observedAt,
          expiresAt,
        },
      ],
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.evaluations[0]).toMatchObject({
      transportSupportStatus: "UNSUPPORTED",
      exclusion: "TRANSPORT_NOT_SELECTABLE",
    });
  });
});
