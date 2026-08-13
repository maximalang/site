# ADR 0012: One safe bounded Hub read model

Status: Accepted

Date: 2026-08-13

## Context

The Hub UI needs Providers, Accounts, models and routes, execution routes,
Agents, Skills, Tools and Projects together. Returning raw persistence rows
would expose credential references, Tool configuration references, Skill source
paths and Agent instructions. Independently loading every component would also
allow inconsistent snapshots and encourage each screen to invent a different
model identity.

## Decision

`GET /api/hub` is the only Hub list read boundary. It requires the same owner
session as World and returns `Cache-Control: no-store`. A strict output schema
contains only explicit summary fields. It nests ModelRoutes under their one
CanonicalModel and rejects duplicate or non-deterministically ordered
identities.

`PostgresHubReader` selects an allowlist of columns inside one read-only,
repeatable-read transaction. Every table and relationship has an explicit
cardinality limit checked before projection. It never selects credential
references, Tool configuration references, Skill source references, Agent
instructions, runtime bindings or Sessions. The API parses the completed
projection again and maps all authorization, reader and schema failures to
bounded non-reflective responses.

## Consequences

- Hub consumers see one coherent PostgreSQL snapshot and cannot infer secret
  locations or runtime addressing.
- Providers and Accounts remain separately visible while model identity stays
  provider-neutral.
- Large or corrupt installations fail closed instead of returning an
  unbounded response.
- Detailed secret management and Agent instruction editing require separate,
  purpose-specific commands; they cannot be added accidentally to a list query.

## Verification

- Schema tests reject private fields, runtime locators, duplicates and ordering
  drift.
- Reader tests inspect the SQL allowlist, transaction mode, projection nesting,
  rollback and overflow behavior.
- Disposable PostgreSQL verifies the real nested projection against v6 data.
- The standalone production bundle verifies anonymous 401, authenticated 200,
  `no-store` behavior through the route contract and absence of private fields.
