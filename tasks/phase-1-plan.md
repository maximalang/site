# Phase 1 plan: real OpenClaw working shell

This plan starts only after the Phase 0 audit gate is accepted. Each slice is a
vertical, reviewable increment and must retain the previous slice's tests.

## Slice 1: Canonical contracts without persistence

Status: complete on `codex/phase-1-contracts`.

Define versioned identifiers and contracts for `Agent`, `AccountRef`,
`ExecutionRoute`, `RuntimeBinding`, `WorldEvent`, `TaskIntent`, approval state
and projection cursors. Prove at the type/schema level that Agent IDs cannot be
runtime session or account IDs.

Verification: schema fixtures, invalid-event rejection, exhaustive event
projection tests and architecture-boundary checks.

Evidence:

- [x] Runtime-prefixed and compile-time branded canonical identifiers.
- [x] Strict Agent, AccountRef, ExecutionRoute and RuntimeBinding schemas.
- [x] Strict TaskIntent and explicit approval-state schemas.
- [x] Provenance-bearing WorldEvent union with no simulation source.
- [x] Replay cursor invariant and negative identity type tests.
- [x] Test, typecheck, lint, build and package-content gates pass.

## Slice 2: OpenClaw read-only adapter

Status: next.

Use only public gateway packages. Connect with least-privilege read scope,
normalize agent/session/presence events, preserve sequence/state version and
emit reconnect/resync telemetry. No task execution yet.

Verification: pinned protocol contract tests, malformed/unordered/duplicate
event tests, disconnect/reconnect replay and credential-redaction tests.

## Slice 3: One API, two projections

Expose one backend event/read-model API. Build the minimal Command agent list
and the primary World canvas from the same `WorldReadModel`. World has no direct
runtime connection and no random dialogue.

Verification: the same fixture/cursor produces equal Agent/status/task identity
in both views; browser accessibility and responsive tests; zero decorative LLM
calls.

## Slice 4: Safe selection and chat

Selecting an Agent in World or Command opens the same conversation projection.
Sending a message creates a canonical intent and dispatches through an explicit
runtime binding; runtime session IDs remain external references.

Verification: idempotent send, retry without duplicate messages, cross-view
continuity, and authorization/policy failures rendered consistently.

## Slice 5: Policy-aware task assignment

Create a task intent, evaluate approval policy, and only then call the
side-effecting OpenClaw method with an idempotency key. Persist observable
accepted/running/completed/failed transitions before projecting animation.

Verification: deny-by-default policy, approval grant/revoke, duplicate request,
adapter timeout, late event, restart and replay scenarios.

## Slice 6: Working-shell hardening

Add structured logs/metrics, bounded event buffers, redaction, adapter health,
reconciliation and operator-visible drift. Package the core Docker Compose
profile and prove backup/restart of the shell state available at this phase.

Verification: isolated end-to-end run against a pinned OpenClaw instance,
restart/reconnect replay, container health versus contract readiness, resource
budget and security checks.

## Stop conditions

- Any import from OpenClaw `src/**` or private agent core.
- Any World-only store or API that diverges from Command.
- Any account/session ID used as Agent identity.
- Any synthetic activity presented as real.
- Any browser-stored gateway/runtime credential.
- Any side effect without approval-policy and idempotency evidence.
