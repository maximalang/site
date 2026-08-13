# Implementation Plan: AI World / Agent Control Center

## Overview

Build a single-owner, self-hosted Agent Operating Environment in which World and
Command are two projections of one canonical domain and API. The project starts
with an evidence-backed OSS reuse audit. Production implementation is gated on
that audit so the product reuses mature components instead of recreating an
agent framework, model gateway, memory stack, or control panels.

## Non-negotiable architecture constraints

- `Agent` is a durable identity and is never an `Account` or a runtime session.
- PostgreSQL is the canonical source of truth; integrated systems are runtime or
  telemetry projections.
- World renders real typed events and never spends LLM tokens on decorative
  animation or chatter.
- All execution backends sit behind a versioned `ExecutionAdapter` contract.
- Consumer ChatGPT Chat/Work scraping is not a production transport.
- One primary World renderer and one model gateway are selected for the first
  production deployment.
- The first deployment targets one VDS with Docker Compose, not Kubernetes.

## Dependency graph

```text
Phase 0 reuse and license audit
  -> canonical domain and event contracts
    -> OpenClaw adapter plus World/Command working shell
      -> canonical Hub and PostgreSQL migrations
        -> model gateway and Codex routes
          -> ContextCompiler, RAG, memory and orchestration
            -> integrations, observability and production hardening
```

## Delivery phases

### Phase 0: Reuse audit (current)

- [x] Record immutable upstream SHAs, versions, licenses, architecture and APIs.
- [x] Inspect World/control-center candidates and choose one primary renderer.
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

- [ ] Integrate one `ModelGateway` implementation and local-model routes.
- [ ] Integrate official ChatGPT-authenticated Codex execution.
- [ ] Represent Chat/Work transports explicitly as official, experimental,
      unsupported or disabled.

### Phases 5-8: Context, memory and orchestration

- [ ] Deliver ContextCompiler plus token/cost governor and pgvector RAG.
- [ ] Deliver Graphiti/FalkorDB memory with evidence and curation.
- [ ] Deliver LangGraph workflows, deterministic routing, handoffs, review,
      retry and approvals.

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
| Consumer ChatGPT automation violates service rules | High | Keep transport disabled unless an official supported path is verified. |
| One-VDS stack becomes operationally excessive | Medium | Keep optional Compose profiles and require the core profile to stand alone. |

## Open questions resolved during Phase 0

- Exact OpenClaw extension boundaries that are stable enough for an adapter.
- Whether `geezerrrr/agent-town` has a legally reusable license at the pinned SHA.
- Which World components can be ported without introducing a second renderer.
- Whether LiteLLM or Bifrost is the better first gateway after current licensing,
  operational and API analysis.
- Which third-party control-center components are reusable code versus patterns.
