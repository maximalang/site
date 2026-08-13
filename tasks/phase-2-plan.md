# Phase 2 plan: canonical Hub

Phase 2 extends the existing canonical PostgreSQL core. It does not replace the
working World, conversation, runtime-binding or Task boundaries from Phase 1.
The Phase 0 reuse decision remains authoritative: port AionUi's
persona/backend and safe skill-path patterns, but keep provider-owned model
arrays and Electron/Rust persistence outside the product domain.

## Slice 1: Hub identities and persistence

Status: complete on `codex/phase-1-contracts` (`e93255f`).

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

Status: implementation complete; UI consumption begins in Slice 4.

Build one bounded owner-only Hub read API for Accounts, Providers, canonical
models with nested ModelRoutes, Routes, Agents, Skills, Tools and Projects.
Credential references, runtime locators and Agent instructions stay outside the
list projection.

Verification: deterministic ordering, no duplicate CanonicalModel cards,
bounded cardinality, strict output parsing, auth/no-store behavior and
standalone production-route coverage.

Evidence:

- [x] Strict, bounded and deterministically ordered Hub wire schema.
- [x] One CanonicalModel projection with nested ModelRoutes.
- [x] Read-only repeatable-read PostgreSQL snapshot over allowlisted columns.
- [x] Credential references, Tool configuration references, Skill source
  references, Agent instructions and runtime locators excluded by construction.
- [x] Owner-authenticated `/api/hub` with `no-store` and fail-closed errors.
- [x] Disposable PostgreSQL and standalone production-bundle verification.

## Slice 3: Idempotent control-plane commands

Status: complete on `codex/phase-1-contracts` (`1bfe19d`, `bf5793f`).

Add narrow commands for Provider, Account metadata, CanonicalModel/ModelRoute,
Agent, Skill, Tool and Project creation. Commands are same-origin, CSRF
protected, caller-idempotent and transactional. Raw provider keys are rejected
until the SecretStore interface is implemented; adding an API key will be a
separate secret-write command in Phase 3.

Verification: create/replay/conflict, duplicate remote model discovery,
cross-provider Account/ModelRoute rejection, invalid Skill integrity and no
partial writes.

Evidence:

- [x] Strict metadata-only contracts reject raw credentials and provider drift.
- [x] PostgreSQL advisory serialization plus immutable SHA-256 receipts.
- [x] Atomic create/replay/conflict behavior for all eight canonical resources.
- [x] Duplicate ModelRoute and cross-provider Account references fail closed.
- [x] Owner authorization, CSRF, same-origin and bounded request enforcement.
- [x] Disposable PostgreSQL and standalone production runtime verification.

## Slice 4: Integrated Lobby UI

Status: complete on `codex/phase-1-contracts`.

Add a Hub/Lobby mode inside the same application. Reuse the canonical Agent
selection and existing Command presentation rather than opening component
dashboards or creating duplicate object pages. Basic values use Auto defaults;
advanced route metadata remains progressively disclosed.

Verification: keyboard navigation, focus, reduced motion, responsive
320/390/768/1024/1440 viewports, Axe, no horizontal overflow, no credentials in
storage or DOM and no network calls to third-party dashboards.

Evidence:

- [x] Hub is a third mode in the existing World/Command shell and remains usable
  when OpenClaw is unavailable.
- [x] One CanonicalModel card owns nested ModelRoutes; advanced route metadata
  is progressively disclosed.
- [x] Providers, Accounts, Routes, Agents, Skills, Tools and Projects use one
  bounded owner-only Hub read model with explicit empty/error states.
- [x] Chromium, Axe, keyboard, console/network and overflow checks pass at all
  five named viewports plus the standalone production smoke test.

## Slice 5: Inherited execution preferences

Status: complete on `codex/phase-1-contracts`.

Store only sparse overrides in one policy table and resolve:

`System Defaults -> Project -> Agent -> Task -> Run`

The read model must identify the winning source for Model, Account, Mode,
Context and Budget. Run scope is reserved until the Run aggregate lands; no
independent copies of the same effective setting are written at each level.

Verification: inheritance, local override, reset, disabled route, same Account
used by multiple Agents and deterministic fallback inputs.

Evidence:

- [x] One sparse PostgreSQL override table resolves System → Project → Agent →
  Task; Run is rejected until the Run aggregate exists.
- [x] Every effective Model, Account, Mode, Context and Budget value carries its
  winning canonical scope, while reset deletes the local value.
- [x] Deterministic eligibility excludes disabled/unavailable Provider,
  Account, CanonicalModel and ModelRoute inputs before fallback ordering.
- [x] Owner-only bounded API enforces auth, CSRF, same-origin writes and strict
  failure classification without returning credential or infrastructure data.
- [x] Lobby UI exposes System/Project/Agent editing, inherited provenance,
  local overrides and per-field reset without materializing inherited copies.
- [x] Unit, disposable PostgreSQL, standalone production runtime, Axe and all
  five required responsive browser viewports pass.

## Stop conditions

- Any model-card identity that contains Provider or Account identity.
- Any raw password, token, API key, cookie or recovery material in PostgreSQL,
  logs, browser storage, API responses or fixtures.
- Any Agent row owned by one Account or runtime Session.
- Any direct browser access to LiteLLM, OpenClaw, AionUi or another component
  dashboard.
- Any provider-specific schema escaping into the canonical Hub API.
- Any destructive rewrite of Phase 1 tables instead of an additive migration.
