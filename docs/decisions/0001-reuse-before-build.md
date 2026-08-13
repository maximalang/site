# ADR-0001: Require a reuse and license audit before production code

## Status

Accepted

## Date

2026-08-13

## Context

The product intentionally combines an agent runtime, game renderer, command
center, model gateway, orchestration, memory, graph visualization, telemetry,
automation, browser infrastructure and MCP isolation. Rebuilding those systems
would create another multi-agent framework and contradict the product goal.
Several candidate repositories also have AGPL, source-available, package-level
or currently unrecognized licenses, so README-level assumptions are unsafe.

## Decision

Production code is blocked until Phase 0 records, for every named upstream:

- immutable source revision and observed release;
- repository and package-level license obligations;
- architecture and stable integration/API boundary;
- reusable modules and domain-model conflicts;
- one of: direct reuse, adapter, fork, component port, reference-only or reject.

Research documents, plans, audit tooling and local ignored clones are allowed
before the gate. Product runtime, UI and infrastructure implementation are not.

## Alternatives considered

### Start from `geezerrrr/agent-town` immediately

This would create fast visible progress, but its license and domain assumptions
must first be verified. It may couple worker/account identity to characters and
therefore violate `Agent != Account`.

### Build a clean-room shell first

Rejected because it would pre-commit the product to custom infrastructure before
proving which mature modules can be reused.

### Run all upstream dashboards side by side

Rejected because the product requires one coherent site and one canonical domain
layer; separate dashboards would duplicate settings and sources of truth.

## Consequences

- The first milestone is documentary and evidence-heavy rather than visual.
- Upstream SHAs and license evidence become build inputs, not informal notes.
- Adapter boundaries can absorb upstream drift without making upstream state
  canonical.
- Any missing or incompatible license defaults to reference-only until resolved.
