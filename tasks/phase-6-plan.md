# Phase 6 Plan: Provenance-aware Memory Center

## Outcome

Create a PostgreSQL-owned memory curation lifecycle and project-scoped
Network, Timeline and Inbox projections. Graphiti/FalkorDB is an optional
temporal-graph projection behind an adapter; it never owns accepted memory,
curation decisions or replay state.

## Fixed boundaries

- Model output creates bounded proposals, never accepted memory directly.
- Every proposal links to one canonical ContextItem and therefore to its exact
  Run/Event/Message/Artifact/Document provenance.
- Curator decisions are `ACCEPT`, `MERGE` or `REJECT`, idempotent, append-only
  and owner-authorized. `MERGE` requires an existing accepted target.
- Accepted memory is materialized as canonical `MEMORY` ContextItems in the
  same transaction as its decision and outbox event.
- Network and Timeline are PostgreSQL read models. Graphiti/FalkorDB may enrich
  temporal traversal but can be rebuilt entirely from canonical events.
- No LLM call is required for curation state changes or UI projections.

## Slice 1: Contracts and canonical lifecycle

- [ ] Add strict identifiers, proposal, decision and projection contracts.
- [ ] Persist proposals and decisions with exact provenance and idempotency.
- [ ] Materialize accepted/merged memory atomically and reject post-decision
      mutation.

## Slice 2: Graph projection adapter

- [ ] Define a replaceable Graphiti projection port and bounded payload.
- [ ] Publish committed memory events through a replayable outbox.
- [ ] Prove restart/replay and projection rebuild without graph authority.

## Slice 3: Memory Center read API and UI

- [ ] Expose project-scoped Inbox, Timeline and Network read models.
- [ ] Add owner-authorized Accept/Merge/Reject commands.
- [ ] Render Simple defaults and Advanced provenance/detail views.

## Verification gate

- Contract tests reject unknown fields, cross-project targets, invalid
  transitions and unprovenanced proposals.
- Disposable PostgreSQL tests prove idempotency, concurrency, atomic
  materialization, project isolation and restart replay.
- API/browser tests prove owner authorization and all three projections.
- Full lint, type, unit, build, database, runtime and Compose gates pass.

