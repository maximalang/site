# Implementation Plan: AI World / Agent Control Center

## Overview

Build a single-owner, self-hosted Agent Operating Environment in which World and
Command are two projections of one canonical domain and API. The project starts
with an evidence-backed OSS reuse audit. Production implementation is gated on
that audit so the product reuses mature components instead of recreating an
agent framework, model gateway, memory stack, or control panels.

## Non-negotiable architecture constraints

- `AgentTemplate` is reusable behavior; an `Agent`/`AgentInstance` is a durable
  mission/project identity and is never an `Account`, Chat or runtime session.
- `Mission` owns the user goal and success criteria above decomposed Tasks and
  concrete Runs.
- PostgreSQL is the canonical source of truth; integrated systems are runtime or
  telemetry projections.
- The append-only PostgreSQL event log is the basis of Action Graph, World
  state, history and deterministic replay.
- World renders real typed events and never spends LLM tokens on decorative
  animation or chatter.
- All execution backends sit behind a versioned `ExecutionAdapter` contract.
- Native Plus Chat uses an on-demand browser launcher only to choose an Account,
  create a Chat and submit `run_id`; output is committed through Control API
  tools and is never read from the DOM.
- Chat context is lazy/pull-based: memory, RAG, skills and project state are
  fetched only when needed under Context/Token Governor budgets.
- One Resource Broker chooses Account/Chat/Work/Codex/API/Local from quality,
  limits, cost, speed and load evidence while transports stay independent.
- LangGraph provides durable orchestration, checkpoints, recovery, retries,
  handoffs and review loops; it does not become a second product state store.
- UI configuration has Simple/Advanced levels and defaults most choices to
  safe `Auto` policies.
- One primary World renderer—the narrow OpenClaw Office presentation port—and
  one model gateway are selected for the first production deployment.
- The first deployment targets one VDS with Docker Compose, not Kubernetes.

## Dependency graph

```text
Phase 0 reuse and license audit
  -> canonical domain and event contracts
    -> OpenClaw adapter plus World/Command working shell
      -> canonical Hub and PostgreSQL migrations
        -> model gateway and Codex routes
          -> Mission + Resource Broker + lazy context + native Chat Control API
            -> ContextCompiler, RAG, memory and LangGraph orchestration
            -> integrations, observability and production hardening
```

## Delivery phases

### Phase 0: Reuse audit (current)

- [x] Record immutable upstream SHAs, versions, licenses, architecture and APIs.
- [x] Reassess World candidates and choose OpenClaw Office as the primary
      presentation layer without importing its backend or stores.
- [x] Inspect runtime, model, memory, orchestration, observability, browser,
      automation and MCP candidates.
- [x] Classify every candidate as direct reuse, fork, component port, adapter,
      reference-only or reject, with reasons and license obligations.
- [x] Publish ADRs for the initial composition and unresolved compliance gates.

### Phase 1: Working shell

- [x] Deliver one web app with World/Command switching over one API.
- [x] Connect real OpenClaw agents, sessions and typed status events.
- [x] Deliver click/chat and policy-aware task assignment.
- [x] Package and verify the hardened single-user Compose core, HTTPS,
      readiness degradation and transactional backup/restore.

### Phase 2: Canonical Hub

- [x] Add PostgreSQL-backed Accounts, Providers, Canonical Models and Routes.
- [x] Add durable Agents, Skills, Tools and Projects without duplicate models.
- [x] Add inherited settings from system through run scope.

### Phases 3-4: Model and Codex execution

- [x] Integrate one `ModelGateway` implementation and local-model routes.
- [ ] Integrate official ChatGPT-authenticated Codex execution.
- [ ] Represent Chat/Work transports explicitly as official, experimental,
      unsupported or disabled.
- [ ] Deliver Native Plus Chat dispatch-only launcher and authenticated
      pull/Control API through one custom MCP/App connected to each Plus
      account, with Custom GPT Actions retained only as a fallback.

### Phases 5-8: Context, memory and orchestration

- [ ] Deliver ContextCompiler plus token/cost governor and pgvector RAG.
- [ ] Deliver Graphiti/FalkorDB memory with evidence and curation.
- [ ] Deliver Memory Center Network, Timeline and Inbox projections with
      provenance-aware Curator `Accept / Merge / Reject` decisions.
- [ ] Deliver LangGraph workflows, deterministic routing, handoffs, review,
      retry and approvals.
- [ ] Deliver Mission decomposition, reusable Agent Templates/Instances,
      Resource Broker scoring and structured position/synthesis/decision
      meetings without free-form token chatter.

### Phases 9-11: Integrations and production readiness

- [ ] Integrate n8n, MCP Gateway, GitHub, SSH/VDS and permitted browser sessions.
- [ ] Integrate Langfuse telemetry behind the product Observatory.
- [ ] Complete native Chat/Work adapter interfaces without unsupported scraping.
- [ ] Verify security, backup/restore, restart/replay and all 24 product-level
      acceptance criteria.

## Checkpoints

### Audit gate

- [x] Every named upstream has current primary-source evidence.
- [x] License obligations and prohibited code movement are explicit.
- [x] Selected composition has no duplicate runtime, renderer or gateway.
- [x] The Phase 1 plan is decomposed into small vertical slices.

### Working-shell gate

- [x] Real OpenClaw events drive both World and Command.
- [x] Restart/reconnect replay restores the same visible state.
- [x] World interactions do not create unsafe actions without approval.

### Production gate

- [x] Required automated test families pass for the completed Phase 0-2 scope.
- [x] Docker Compose core starts without optional profiles.
- [x] Backup/restore and upgrade are verified on an isolated environment.
- [ ] Every acceptance criterion has authoritative runtime evidence.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Upstream license differs from repository metadata | High | Read LICENSE/NOTICE and package-level terms at pinned SHA before reuse. |
| Upstream APIs drift rapidly | High | Pin commit/tag, isolate through adapters and add contract tests. |
| AGPL or source-available UI contaminates permissive core | High | Treat as reference-only or separately deployed service unless an explicit licensing decision is accepted. |
| World UI imports the wrong Agent/Account model | High | Define canonical contracts before porting UI state. |
| Multiple sources of truth emerge | High | Persist authority in PostgreSQL and make all runtime configs projections. |
| Browser automation becomes an unsupported Chat state/output channel | High | Isolate launcher to opening an authenticated Account/Chat and submitting `run_id`; accept results only through authenticated supported Actions/App tools. |
| One-VDS stack becomes operationally excessive | Medium | Keep optional Compose profiles and require the core profile to stand alone. |

## Open questions resolved during Phase 0

- Exact OpenClaw extension boundaries that are stable enough for an adapter.
- Whether `geezerrrr/agent-town` has a legally reusable license at the pinned SHA.
- Which World components can be ported without introducing a second renderer.
- Whether LiteLLM or Bifrost is the better first gateway after current licensing,
  operational and API analysis.
- Which third-party control-center components are reusable code versus patterns.
