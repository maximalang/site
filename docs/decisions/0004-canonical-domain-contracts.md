# ADR 0004: Canonical domain and event contracts

- Status: Accepted
- Date: 2026-08-13

## Context

Every runtime, service, World renderer and Command panel must agree on identity
and event meaning before they connect. A plain UUID or TypeScript-only alias
cannot stop an Account or Session ID from entering an Agent field at a JSON/API
boundary. Permissive objects can also silently accept credentials or upstream
fields that the canonical domain never intended to own.

## Decision

Use `@agent-world/domain` as the one versioned wire-contract package.

- Canonical IDs use a semantic prefix plus lowercase UUID, such as `agent_...`,
  and a distinct Zod/TypeScript brand.
- Durable top-level wire objects carry `schemaVersion: 1`.
- External objects are strict and bounded. Unknown properties, cross-identity
  substitutions and control characters in opaque runtime IDs fail validation.
- Runtime identity is represented only through `RuntimeBinding`; it never
  becomes the Agent primary key.
- `WorldEvent` is a closed discriminated union with a positive sequence and an
  explicit `RUNTIME` or `DOMAIN` source. No simulation source exists.
- Replay cursors pair a sequence with the exact last Event ID, except for the
  explicit zero/initial cursor.

The schemas use Zod 4's documented parse/safe-parse and inferred-type model:
<https://zod.dev/basics>. The package build uses TypeScript project references:
<https://www.typescriptlang.org/docs/handbook/project-references>.

## Alternatives considered

### Plain UUID strings

Rejected. They are indistinguishable at runtime and easy to substitute across
Agent, Account, Session and Route fields.

### TypeScript brands without runtime prefixes

Rejected. Brands disappear at JSON, database and third-party adapter boundaries.

### Runtime-owned event objects

Rejected. They couple both UIs to OpenClaw internals and allow upstream sessions
or narration to become product truth without validation.

### Permissive schemas for forward compatibility

Rejected. Silent field acceptance creates accidental contracts and can admit
credentials. Compatibility is achieved through additive explicit fields and
schema-version migrations.

## Consequences

- Adapters perform explicit normalization work before persistence.
- Prefix changes are wire-format breaking changes and require migration.
- The event union must be extended deliberately as real product behavior grows.
- PostgreSQL constraints and API schemas must reuse or mechanically mirror these
  invariants; they may not define a competing identity model.
