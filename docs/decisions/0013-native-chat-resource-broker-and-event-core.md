# ADR 0013: Native Chat, Resource Broker and event core

- Status: Accepted
- Date: 2026-08-14

## Context

AI World must use personal ChatGPT Plus as a native execution surface without
making consumer DOM output, cookies or private endpoints part of production
state. It must also avoid duplicating agents and routing logic as more Accounts
and transports are connected.

## Decision

Native Plus Chat is an independent `ChatTransport`. An isolated on-demand
launcher selects an already authenticated Account, opens the configured Chat
surface and submits only canonical `run_id`. The launcher never observes output
or waits for completion. `run_id` is not a bearer credential.

The Chat agent authenticates to the single AI World Control Plane, calls
`begin_run`, lazily pulls bounded task/project/memory/RAG/skill/artifact/history
resources, emits structured intermediate events and terminates through exactly
one `commit_result` or `fail`. Account identity comes from OAuth/app auth, not a
request-supplied Account field. Custom GPT Actions are the supported Plus bridge
until the same use cases can be exposed through a live-verified personal Plus
App/Plugin write surface.

A product-owned Resource Broker chooses among eligible
Account/Chat/Work/Codex/API/Local candidates. It consumes normalized evidence
for quality, remaining limits, marginal cost, latency and load, then records the
inputs, policy version, decision and fallback reason. It owns policy, not
provider execution; every transport remains replaceable behind its adapter.

`Mission` sits above Tasks and stores a user goal plus success criteria.
Reusable `AgentTemplate` behavior is separate from project/Mission-bound
`AgentInstance` identity and per-attempt Runs. Meetings are bounded records of
positions followed by one synthesis and one decision.

The append-only PostgreSQL event log is the canonical history from which Action
Graph, World, Task/Run state, Memory Inbox and replay are projected. LangGraph
stores orchestration checkpoints and references canonical IDs; it owns durable
control flow, retries, recovery, handoffs and review loops, not canonical
product state. World animation is deterministic UI projection with no LLM call.

Memory Center has Network, Timeline and Inbox views. Graphiti/FalkorDB and
pgvector are derived indexes; curator proposals remain pending until the owner
chooses `Accept`, `Merge` or `Reject`, with provenance preserved.

Settings expose a Simple layer with safe `Auto` defaults and an Advanced layer
for explicit policies. Product-owned infrastructure stays limited to AI World
UI, Unified Hub, Resource Broker, Context/Token Governor, shared Event/Memory
layer and Native Chat integration. OpenClaw, Agent Town, LiteLLM, LangGraph,
Graphiti/FalkorDB, PostgreSQL/pgvector, Langfuse, n8n and MCP remain the selected
reused components.

## Consequences

- Chat-visible text cannot complete a Run; only ordered authenticated backend
  events can.
- Initial prompts stay small, and token consumption is attributable to explicit
  pulls and outputs.
- One AI World owner can connect multiple ChatGPT Accounts without merging
  Accounts into Agents or creating duplicate control planes.
- Provider capability drift is isolated to transport readiness. Personal Plus
  App/Plugin writes remain experimental until official and live evidence exists.
- Every operational and game-world view can be rebuilt from canonical events;
  graph, memory and orchestration services may be replaced without losing truth.

## Rejected alternatives

- Scraping final Chat output or polling the response DOM.
- Sending a full eager ContextPack in every Chat launch.
- Treating `run_id` as authentication.
- One Agent record per Account, Chat or Run.
- Letting LangGraph, Graphiti, OpenClaw or the World renderer own canonical state.
- Free-form multi-agent meetings or LLM-generated decorative World activity.
- Building custom equivalents of the selected mature infrastructure services.
