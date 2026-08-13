# Phase 2 plan: canonical Hub

Phase 2 extends the existing canonical PostgreSQL core. It does not replace the
working World, conversation, runtime-binding or Task boundaries from Phase 1.
The Phase 0 reuse decision remains authoritative: port AionUi's
persona/backend and safe skill-path patterns, but keep provider-owned model
arrays and Electron/Rust persistence outside the product domain.

## Slice 1: Hub identities and persistence

Add strict contracts and an additive migration for Provider, enriched Account,
CanonicalModel, ModelRoute, versioned Skill, Tool and Project membership.
Preserve existing Account, Agent, ExecutionRoute and Project rows through a
deterministic migration.

Invariants:

- Agent, Account, Provider, Model, ModelRoute and runtime Session IDs are
  distinct branded identities.
- A physical model has one CanonicalModel row; provider/account/surface variants
  are ModelRoutes, not duplicate model cards.
- One Account may back routes for multiple Agents and one Agent may change
  routes without changing identity.
- Credentials are never stored as values. Account persistence may contain only
  an opaque reference owned by a later SecretStore adapter.
- Skills are versioned and integrity-addressed. Tools are canonical resources,
  not prompt strings.
- Project-to-Agent membership is explicit and backfilled from existing
  Conversations.

Verification: strict schema tests, negative identity/type tests, migration
ledger, foreign-key/cross-identity rejection, deduplication constraints and
disposable PostgreSQL upgrade evidence.

## Slice 2: One safe Hub read model

Build one bounded owner-only Hub read API for Accounts, Providers, canonical
models with nested ModelRoutes, Routes, Agents, Skills, Tools and Projects.
Credential references, runtime locators and Agent instructions stay outside the
list projection.

Verification: deterministic ordering, no duplicate CanonicalModel cards,
bounded cardinality, strict output parsing, auth/no-store behavior and
standalone production-route coverage.

## Slice 3: Idempotent control-plane commands

Add narrow commands for Provider, Account metadata, CanonicalModel/ModelRoute,
Agent, Skill, Tool and Project creation. Commands are same-origin, CSRF
protected, caller-idempotent and transactional. Raw provider keys are rejected
until the SecretStore interface is implemented; adding an API key will be a
separate secret-write command in Phase 3.

Verification: create/replay/conflict, duplicate remote model discovery,
cross-provider Account/ModelRoute rejection, invalid Skill integrity and no
partial writes.

## Slice 4: Integrated Lobby UI

Add a Hub/Lobby mode inside the same application. Reuse the canonical Agent
selection and existing Command presentation rather than opening component
dashboards or creating duplicate object pages. Basic values use Auto defaults;
advanced route metadata remains progressively disclosed.

Verification: keyboard navigation, focus, reduced motion, responsive
320/390/768/1024/1440 viewports, Axe, no horizontal overflow, no credentials in
storage or DOM and no network calls to third-party dashboards.

## Slice 5: Inherited execution preferences

Store only sparse overrides in one policy table and resolve:

`System Defaults -> Project -> Agent -> Task -> Run`

The read model must identify the winning source for Model, Account, Mode,
Context and Budget. Run scope is reserved until the Run aggregate lands; no
independent copies of the same effective setting are written at each level.

Verification: inheritance, local override, reset, disabled route, same Account
used by multiple Agents and deterministic fallback inputs.

## Stop conditions

- Any model-card identity that contains Provider or Account identity.
- Any raw password, token, API key, cookie or recovery material in PostgreSQL,
  logs, browser storage, API responses or fixtures.
- Any Agent row owned by one Account or runtime Session.
- Any direct browser access to LiteLLM, OpenClaw, AionUi or another component
  dashboard.
- Any provider-specific schema escaping into the canonical Hub API.
- Any destructive rewrite of Phase 1 tables instead of an additive migration.
