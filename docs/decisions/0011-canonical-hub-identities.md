# ADR 0011: Canonical Hub identities and route boundaries

Status: Accepted

Date: 2026-08-13

## Context

Phase 2 must represent providers, accounts, models, skills, tools and projects
without collapsing them into Agent or runtime Session identity. Provider model
lists frequently repeat the same physical model for each account or access
surface. Persisting those lists directly would create duplicate model cards and
make routing metadata part of model identity. Provider credentials also cannot
become ordinary domain values.

## Decision

The Hub stores one `CanonicalModel` for a physical model and a separate
`ModelRoute` for each Provider, optional Account, execution surface and remote
model identity. The database rejects duplicate route identities, an Account
used under the wrong Provider and a route on a surface that Account does not
offer.

`Provider`, `Account`, `Agent`, `ExecutionRoute`, `ModelRoute` and runtime
`Session` remain separately branded identities. An Account can back multiple
ExecutionRoutes, and multiple Agents can prefer those routes without the
Account owning either Agent. Projects relate to Agents through explicit
membership and existing Conversation pairs are backfilled during migration.

Accounts and Tools may store only constrained secret-store references. Raw
passwords, API keys, tokens and connection strings are outside the Hub schema.
Skills are versioned and integrity-addressed; Tools are canonical resources
rather than prompt fragments.

Migration `0006_canonical_hub.sql` is additive. Existing pre-Hub Accounts are
classified as unconfigured OpenClaw accounts, their observed route surfaces are
preserved, and existing Project/Agent Conversation pairs become memberships.

## Consequences

- The UI can nest route health, cost and limits under one model card without
  inventing provider-owned model identity.
- Account rotation or Agent route changes do not mutate Agent identity or
  Conversation history.
- The later routing policy can select among explicit, comparable ModelRoutes.
- Secret resolution remains an adapter concern and cannot leak through a Hub
  read model by selecting an ordinary credential column.
- Control-plane commands must create related rows transactionally so required
  modality and assignment collections cannot be partially persisted.

## Verification

- Strict runtime and compile-time contracts reject identity substitution,
  duplicate capabilities, inline Tool secrets and unsafe Provider URLs.
- A disposable PostgreSQL 18.3 verifier upgrades seeded v5 state to v6 and
  reapplies the migration set to prove ledger idempotency.
- Database scenarios prove canonical model nesting, route deduplication,
  Provider/Account/surface foreign keys, shared Account reuse and legacy
  Project membership backfill.
