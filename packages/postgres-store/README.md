# `@agent-world/postgres-store`

Canonical PostgreSQL persistence and migrations for the Agent Operating
Environment. Runtime systems are projections; they do not replace these tables
as product authority.

## Migration contract

- Migration filenames are ordered `NNNN_name.sql` and carry SHA-256 checksums.
- A transaction-scoped PostgreSQL advisory lock serializes migration runners.
- The migration ledger rejects unknown applied versions and checksum/name drift.
- Every migration and its ledger insert commit together or roll back together.
- SQL constraints mirror the branded domain prefixes, Agent/Conversation/
  Session joins, one active Session per Conversation, delivery states and
  domain/runtime provenance.

The runner uses one checked-out `pg` client for the whole transaction and
parameterizes ledger values. Application query methods must follow the same
rule; no string-interpolated user or runtime values are permitted.

## Conversation send semantics

`PostgresConversationStore.prepareSend` takes transaction-scoped advisory locks
for both the idempotency key and canonical Message ID. It then claims or loads
the immutable intent, verifies the canonical Conversation/Agent pair, and
persists one active Session plus enabled same-Agent Binding before any runtime
call.

- A completed exact duplicate is `REPLAY` and creates no runtime call.
- A later retry preserves the first persisted message timestamp; retry arrival
  time is not part of the immutable idempotency tuple.
- An `ACCEPTED` or `FAILED` exact duplicate resumes through the same persisted
  Session and Binding.
- A reused key or Message ID with different immutable input is
  `IDEMPOTENCY_CONFLICT`.
- A closed original Session is not silently replaced during retry; explicit
  rebinding is a separate future audited domain command.
- Delivery transitions use compare-and-set updates. Provider errors and raw
  database details are mapped by the application service, not returned to API
  callers.

`PostgresConversationReader` uses bounded keyset pagination over
`(created_at, id)` and delegates the browser-safe shape to
`@agent-world/read-model`. Session IDs, Binding IDs, external message IDs,
external Agent IDs and Agent instructions are validated server-side but omitted
from the returned projection.

## Owner session semantics

`PostgresOwnerSessionStore` persists only SHA-256 digests of random opaque
session tokens. It resolves unexpired, unrevoked sessions; records immediate
revocation; and prunes expired or long-revoked rows. Raw cookies, passwords and
CSRF secrets are not database fields.

The single-owner login throttle is one PostgreSQL-serialized row. At most five
attempts enter a 15-minute window, including under concurrent requests. A
successful login explicitly resets the window. This is application-layer
defense in depth; private binding and reverse-proxy rate limits remain required
deployment controls.

## Isolated verification

The verifier refuses arbitrary database URLs. It requires an explicit isolated
acknowledgement and creates a unique Docker container on a random loopback port
with PostgreSQL data on tmpfs:

```powershell
$env:AGENT_WORLD_DB_TEST_ACK='isolated'
npm run test:db
```

It pins the official `postgres:18.3-bookworm` linux/amd64 manifest digest
`sha256:4b2a518e377fe4cbb67168b8043724634f144cbad35a306c6bab44fced4ec2c7`,
applies the migration set twice, exercises eleven conversation-store scenarios,
one runtime-locator-redaction reader scenario and six owner-auth scenarios,
checks the ledger/tables, and removes only its strictly named container plus
attached anonymous volumes in `finally`.

This proves migration compatibility on an isolated database. It does not prove
backup/restore, production credentials, production deployment, or upgrade from
an earlier released schema.
