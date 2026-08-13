# ADR 0007: Canonical PostgreSQL boundary

- Status: Accepted
- Date: 2026-08-13

## Context

Conversation delivery now has canonical domain contracts, a fail-closed
application service and a narrow OpenClaw transport. Persisting those facts in
memory or in a runtime transcript would violate the product requirement that
PostgreSQL is the single source of truth and would make restart/replay depend on
an execution backend.

## Decision

Introduce `@agent-world/postgres-store` as the only canonical persistence
adapter. Use current stable `pg` with exact versions and plain reviewed SQL
migrations rather than adding an ORM before query requirements justify one.

- Every transaction uses one checked-out client.
- Every external value is parameterized.
- A checksum ledger plus transaction advisory lock owns schema ordering.
- PostgreSQL constraints mechanically mirror canonical identity prefixes,
  relational ownership, session continuity, message delivery and provenance.
- `ConversationCommandStore.prepareSend` will atomically claim idempotency,
  select the active Session/Binding and persist the owner message.
- Runtime transcripts and OpenClaw receipts remain evidence/projections, never
  canonical truth.

The isolated database verifier pins an official PostgreSQL 18.3 image by
platform digest and cannot receive a user database URL.

## Alternatives considered

### In-memory store for the first chat UI

Rejected. It would make the visible feature pass demos while failing restart,
concurrency and the explicit source-of-truth requirement.

### Runtime transcript as canonical conversation history

Rejected. Runtime Sessions are replaceable, and one canonical Conversation can
span multiple runtime Sessions.

### Introduce an ORM now

Deferred. Current requirements need a small number of transaction-heavy,
constraint-sensitive queries. Plain SQL plus `pg` is smaller and more auditable;
an ORM can be evaluated when the broader Phase 2 schema makes its benefits
concrete.

## Consequences

- SQL and Zod constraints must evolve together and incompatible changes require
  a new migration plus contract tests.
- Database integration tests require Docker and explicit isolated acknowledgement.
- Backup/restore and production database lifecycle remain later production
  gates; migration PASS alone does not satisfy them.
