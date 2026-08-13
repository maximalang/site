# ADR 0005: OpenClaw read-adapter boundary

- Status: Accepted for Phase 1
- Date: 2026-08-13

## Context

World and Command need real runtime status before task execution exists. Direct
WebSocket code would duplicate OpenClaw authentication, reconnect, request
correlation and sequence behavior. Exposing the Gateway's generic `request`
method would also make a nominally read-only integration capable of mutations.

The current official OpenClaw client and protocol packages provide the required
public Node transport and protocol-v4 contracts, but the package-bearing release
available during this decision is `2026.8.1-beta.1`. Presence is explicitly an
ephemeral device/Gateway projection and is not Agent liveness.

## Decision

Use exact `@openclaw/gateway-client@2026.8.1-beta.1` and
`@openclaw/gateway-protocol@2026.8.1-beta.1` dependencies behind
`@agent-world/openclaw-adapter`.

- The Node client owns challenge authentication, transport and reconnect.
- The adapter negotiates protocol v4 as `operator` with exactly
  `operator.read`; any authority drift fails closed and closes the client.
- The adapter's narrow Gateway interface contains only `agents.list`,
  `sessions.list`, `sessions.subscribe` and `system-presence`. No generic
  request function is public.
- Events only invalidate the projection. Authoritative read RPCs rebuild it.
- Sequence is scoped to a connection, resets after hello and is paired with a
  monotonically increasing local connection epoch. Gaps force a reload;
  duplicates and stale events do not.
- Runtime IDs remain external references joined through an existing canonical
  `RuntimeBinding`.
- Credentials stay server-side. Remote plaintext WebSockets and credentials in
  URLs are rejected.
- Telemetry uses bounded categories and never copies payloads, error messages,
  endpoints or upstream identifiers.

The adapter imports only documented package roots/subpaths. Any future need for
`openclaw/src/**`, package `dist/**` internals or private agent core is a stop
condition and requires a new decision.

## Alternatives considered

### Custom WebSocket transport

Rejected. It would reproduce security- and ordering-sensitive behavior already
owned by the official client and would create a second reconnect contract.

### Generic Gateway request wrapper

Rejected. Type-level read-only intent would not prevent a caller from issuing a
write/admin method.

### Treat event payloads as runtime truth

Rejected. Event payloads can be partial, reordered or duplicated. Reloading an
authoritative bounded projection makes reconnect and gap recovery deterministic.

### Treat presence as Agent liveness

Rejected. Official semantics describe device/Gateway presence with TTL and a
bounded list; it cannot establish that a canonical Agent is executing.

## Consequences

- Slice 2 proves contract behavior with deterministic fakes, not live Gateway
  compatibility or deployment readiness.
- Slice 6 must run an isolated pinned OpenClaw instance and exercise real hello,
  read scopes, response shapes, disconnect, reconnect and replay.
- A production release is blocked while the public package dependency remains a
  prerelease unless that risk is explicitly accepted with the live integration
  evidence above.
- Side-effecting task methods remain out of scope until Slice 5 adds policy,
  approval, persistence and idempotency as one reviewed boundary.

Official references:

- <https://docs.openclaw.ai/gateway/clients>
- <https://docs.openclaw.ai/gateway/protocol>
- <https://docs.openclaw.ai/concepts/presence>
