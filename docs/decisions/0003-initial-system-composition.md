# ADR 0003: Initial system composition

- Status: Accepted for Phase 1 planning
- Date: 2026-08-13

## Decision

The initial composition is:

- PostgreSQL as canonical domain/event authority;
- OpenClaw as the sole general agent runtime, behind public gateway contracts;
- a narrow MIT Agent Town renderer fork for World;
- the product web app as the only World/Command UI and API surface;
- LiteLLM core as the first and only model gateway, behind `ModelGateway`;
- official Codex SDK as a specialist `ExecutionAdapter` when Phase 4 starts;
- LangGraph for durable orchestration;
- pgvector for RAG and Graphiti/FalkorDB for temporal memory;
- Sigma/Graphology for Memory Network and React Flow for editable graphs;
- Langfuse, n8n, Docker MCP Gateway and Steel as optional isolated services.

## Boundaries

Integrated systems receive projections and return validated events. They never
own product identity, inherited settings, route policy, approvals, run state or
the Action Graph. Third-party raw panels are not user-facing.

Only one gateway and one renderer run in the initial deployment. Optional
services are Compose profiles with explicit resource budgets and contract
health checks.

Direct Codex app-server WebSocket is not a production dependency while official
documentation marks it experimental/unsupported. The SDK adapter is the
supported default; richer transport features remain behind a maturity flag.

## Consequences

- Most infrastructure is reused without creating multiple sources of truth.
- Open-core/source-available components stay process-separated and excluded
  from product-core code.
- Bifrost can replace LiteLLM through one interface, but cannot run concurrently
  as a second routing/cost authority.
- The single-VDS core can start without graph memory, observability, automation,
  MCP or persistent browser profiles.
