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

Status: complete on `codex/phase-1-contracts`.

Use only public gateway packages. Connect with least-privilege read scope,
normalize agent/session/presence events, preserve sequence/state version and
emit reconnect/resync telemetry. No task execution yet.

Verification: pinned protocol contract tests, malformed/unordered/duplicate
event tests, disconnect/reconnect replay and credential-redaction tests.

Evidence:

- [x] Exact official client/protocol prerelease dependencies with protocol v4.
- [x] Exact `operator.read` authority and four-method read-only interface.
- [x] Canonical binding-first Agent/session/presence normalization.
- [x] Duplicate, stale and forward-gap handling with authoritative reload.
- [x] Reconnect epoch/sequence reset and late-response suppression.
- [x] Loopback/WSS, credential and no-secret telemetry boundaries.
- [x] Test, typecheck, lint, build, package-content and dependency-integrity
  gates pass.
- [x] Production maturity limitation recorded: no live Gateway proof in Slice 2
  and the package-bearing OpenClaw release is currently prerelease.

## Slice 3: One API, two projections

Status: complete on `codex/phase-1-contracts`.

Expose one backend event/read-model API. Build the minimal Command agent list
and the primary World canvas from the same `WorldReadModel`. World has no direct
runtime connection and no random dialogue.

Verification: the same fixture/cursor produces equal Agent/status/task identity
in both views; browser accessibility and responsive tests; zero decorative LLM
calls.

Evidence:

- [x] One strict, bounded `WorldReadModel` endpoint with no-store semantics.
- [x] World and Command derive from the same validated model and cursor.
- [x] Selection resolves to the same canonical Agent/status/task inspector in
  both projections.
- [x] The narrow Agent Town Canvas port contains no store, random simulation,
  generated dialogue or runtime transport.
- [x] Contract fixtures are visibly labelled, development-only and rejected in
  production.
- [x] Chromium tests pass at 320, 390, 768, 1024 and 1440 CSS-pixel widths with
  keyboard tab behavior, axe, network, console and overflow assertions.
- [x] The traced standalone artifact serves its own static chunks, rejects the
  fixture switch in production and excludes development CSP capabilities.
- [x] Test, typecheck, lint, production build, dependency audit and visual
  artifact gates pass.

## Slice 4: Safe selection and chat

Status: complete on `codex/phase-1-contracts`.

Selecting an Agent in World or Command opens the same conversation projection.
Sending a message creates a canonical intent and dispatches through an explicit
runtime binding; runtime session IDs remain external references.

Verification: idempotent send, retry without duplicate messages, cross-view
continuity, and authorization/policy failures rendered consistently.

Server evidence:

- [x] Canonical Conversation remains independent from replaceable Sessions.
- [x] PostgreSQL idempotency, retry, redaction and bounded pagination.
- [x] Exact `operator.write` OpenClaw transport and READY-only resolution.
- [x] Opaque PostgreSQL owner sessions, CSRF and authenticated API routes.
- [x] Pre-request startup, standalone migration packaging and restart revocation.
- [x] Login and conversation UI from both World and Command.
- [x] Authoritative inbound Agent messages persisted with exact Session/binding provenance.
- [x] Live pinned OpenClaw protocol-v4 read/write handshake, real `agent` /
  `agent.wait` turn and canonical transcript round trip against a disposable
  loopback model provider.
- [x] Restart-safe persisted World event cursor/replay.

## Slice 5: Policy-aware task assignment

Status: complete on `codex/phase-1-contracts`.

Create a task intent, evaluate approval policy, and only then call the
side-effecting OpenClaw method with an idempotency key. Persist observable
accepted/running/completed/failed transitions before projecting animation.

Verification: deny-by-default policy, approval grant/revoke, duplicate request,
adapter timeout, late event, restart and replay scenarios.

Assignment evidence:

- [x] Owner-authenticated same-origin assignment API with CSRF protection.
- [x] Project and approval policy derived server-side from one active canonical
  Conversation Session; runtime locators never enter the browser contract.
- [x] Task and `TASK_ASSIGNED` event persist atomically with a gapless World
  cursor and exact idempotent replay.
- [x] Every assignment is `REQUIRED` and does not call the runtime or claim
  execution before a separate approval decision.
- [x] World and Command expose the same assigned Task after restart.
- [x] Persist approval grant/deny/revoke, create one canonical Run and dispatch
  only an approved Task through the side-effecting adapter.
- [x] Persist `DISPATCH_PENDING`, `RUNNING`, `COMPLETED`, `FAILED` and
  pre-dispatch `CANCELLED` transitions with exact upstream receipt provenance.
- [x] Recover pending/running Runs through a bounded non-overlapping supervisor;
  retry the unchanged dispatch idempotency key after ambiguous failures.
- [x] Project approval and Run status through the same gapless World event
  stream used by World and Command.

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
