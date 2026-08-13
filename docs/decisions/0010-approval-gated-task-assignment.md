# ADR 0010: Approval-gated canonical task assignment

Status: Accepted

Date: 2026-08-13

## Context

Phase 1 needs a real task-assignment action from both World and Command. A chat
message is not a Task, and choosing an Agent must not immediately create a
runtime side effect. The browser also must not choose Project identity,
approval policy, runtime Session identity or an idempotency policy.

## Decision

`POST /api/tasks` accepts a caller-owned Task ID, canonical Conversation ID,
Agent ID, title and optional description. The server derives the Project from
the Conversation, derives the idempotency key from the Task ID and always sets
`approvalRequirement` to `REQUIRED`.

PostgreSQL accepts the command only when the Conversation belongs to the Agent
and has exactly one active OpenClaw Session backed by an enabled binding. One
transaction stores the Task and one `TASK_ASSIGNED` domain event under the
shared gapless World cursor. Exact retries return the stored Task; conflicting
Task or idempotency identities fail closed.

Assignment never invokes OpenClaw and never claims that execution started. A
later approval command must persist an explicit decision before a Run may be
created and dispatched.

The safe Agent conversation index exposes only a boolean
`taskAssignmentAvailable` capability. It does not expose Session, binding or
external runtime identifiers.

## Consequences

- Agent selection, Conversation context, Task persistence and World projection
  share canonical identities without making Agent equal to Account or Session.
- World and Command can show the assigned Task after restart while keeping the
  runtime replaceable.
- The UI can offer only currently valid assignment targets without learning a
  runtime locator.
- Assignment is intentionally useful but non-executing until the separate
  approval and Run slice lands.

## Verification

- Contract tests reject caller-owned Project/approval fields and responses that
  weaken `REQUIRED`.
- Store and disposable PostgreSQL tests cover create, replay, identity conflict,
  active-Session enforcement, cross-Project rejection and restart replay.
- Standalone runtime verification covers authentication, CSRF and the canonical
  Session target guard across the production bundle boundary.
- Five responsive Chromium projects cover World and Command entry points,
  focus restoration, no horizontal overflow, task drawer Axe results and real
  request payloads without decorative runtime calls.
