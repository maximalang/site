# Implementation Plan: AI World / Agent Control Center

## Overview

Build a single-owner, self-hosted Agent Operating Environment in which World and
Command are two projections of one canonical domain and API. Reuse decisions
are evidence-backed and pinned; PostgreSQL remains canonical while runtimes,
model gateways, memory graphs and telemetry systems remain adapters or
projections.

This web surface is an owner control shell, not a customer billing product. It
must not grow checkout, payment collection, invoices, subscription sales or a
provider-billing ingestion/reconciliation subsystem. Cost signals may appear as
bounded operational estimates when execution providers expose them, but they
are never presented as a customer charge or invoiced truth.

## Current verification state

Repository implementation for Phases 0-11 is present. The full CI matrix at
commit `0e34d0e7158fc28003d15c1304da4d93c325ef0d` passes all eight jobs. The
current authoritative product matrix is
[`docs/audits/acceptance-2026-08-17.md`](../docs/audits/acceptance-2026-08-17.md):
**22/24 PASS, 2/24 PARTIAL, 0/24 OPEN**.

The two product-acceptance gaps are external live proofs, not missing repo
surfaces:

- criterion 4: one real personal Plus AI World MCP/App run through terminal
  `commit_result`;
- criterion 18: one approved bounded operation against a real provisioned SSH
  host with its pinned host key.

A successful real ChatGPT-authenticated Codex Run is also required before full
production activation, although it is separate from the numbered 24-item
product matrix. These gates must not be replaced with fixtures or marked green
from deterministic CI alone.

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
- Native Plus Chat uses an on-demand host-local browser launcher only to choose
  an Account, create a Chat and submit `run_id`; output is committed through
  supported Control/MCP tools and is never read from the DOM. The laptop does
  not connect to PostgreSQL; it uses a scoped HTTPS launcher-control endpoint.
- Chat context is lazy/pull-based: memory, RAG, skills and project state are
  fetched only when needed under Context/Token Governor budgets.
- One Resource Broker chooses Account/Chat/Work/Codex/API/Local from quality,
  limits, cost, speed and load evidence while transports stay independent.
- LangGraph provides durable orchestration, checkpoints, recovery, retries,
  handoffs and review loops; it does not become a second product state store.
- UI configuration has Simple/Advanced levels and defaults most choices to
  safe `Auto` policies.
- One primary World renderer—the narrow OpenClaw Office presentation port—and
  one model gateway are selected for production.
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

### Phase 0: Reuse audit

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
- [x] Integrate the official Codex SDK/CLI execution path and ChatGPT-auth
      readiness boundary. Successful owner-authenticated activation remains a
      production live gate rather than a repo-level implementation gap.
- [x] Represent Chat/Work transports explicitly as official, experimental,
      unsupported or disabled.
- [x] Deliver Native Plus Chat dispatch-only launcher and authenticated
      pull/Control API through one custom MCP/App connected to each Plus
      account, with Custom GPT Actions retained only as a fallback.

### Phases 5-8: Context, memory and orchestration

- [x] Deliver ContextCompiler plus token/cost governor and pgvector RAG.
- [x] Deliver Graphiti/FalkorDB memory with evidence and curation.
- [x] Deliver Memory Center Network, Timeline and Inbox projections with
      provenance-aware Curator `Accept / Merge / Reject` decisions.
- [x] Deliver LangGraph workflows, deterministic routing, handoffs, review,
      retry and approvals.
- [x] Deliver Mission decomposition, reusable Agent Templates/Instances,
      Resource Broker scoring and structured position/synthesis/decision
      meetings without free-form token chatter.

### Phases 9-11: Integrations and production readiness

- [x] Integrate n8n, MCP Gateway, GitHub, SSH/VDS and permitted browser sessions.
- [x] Integrate Langfuse telemetry behind the product Observatory.
- [x] Complete native Chat/Work adapter interfaces without unsupported scraping.
      `CHAT` has its dispatch/Control API contract; `WORK` is explicitly
      `UNSUPPORTED` and non-selectable until a supported transport is proven.
- [x] Verify automated security, dependency signatures, backup/restore,
      restart/replay, PostgreSQL/runtime, responsive browser, Compose,
      orchestration, OpenClaw, LiteLLM and Codex test families.
- [ ] Pass all 24 product-level acceptance criteria with real evidence. Current:
      22 PASS / 2 PARTIAL / 0 OPEN; see the authoritative acceptance audit.

## Checkpoints

### Audit gate

- [x] Every named upstream has primary-source evidence at the pinned version/SHA.
- [x] License obligations and prohibited code movement are explicit.
- [x] Selected composition has no duplicate runtime, renderer or gateway.
- [x] Delivery plans are decomposed into vertical slices with acceptance tests.

### Working-shell gate

- [x] Real OpenClaw events drive both World and Command.
- [x] Restart/reconnect replay restores the same visible state.
- [x] World interactions do not create unsafe actions without approval.

### Production gate

- [x] Full automated CI matrix is green on the current audited head.
- [x] Docker Compose core starts without optional profiles.
- [x] Backup/restore and upgrade behavior are verified on an isolated environment.
- [x] Every numbered acceptance criterion has an authoritative evidence row and
      no criterion is `OPEN`.
- [ ] Every numbered acceptance criterion is `PASS` in real product scope.
- [ ] One successful real owner-authenticated Codex Run records terminal
      provenance.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Upstream license differs from repository metadata | High | Read LICENSE/NOTICE and package-level terms at pinned SHA before reuse. |
| Upstream APIs drift rapidly | High | Pin commit/tag, isolate through adapters and add contract tests. |
| AGPL or source-available UI contaminates permissive core | High | Treat as reference-only or separately deployed service unless an explicit licensing decision is accepted. |
| World UI imports the wrong Agent/Account model | High | Keep canonical contracts and branded IDs at every adapter boundary. |
| Multiple sources of truth emerge | High | Persist authority in PostgreSQL and make runtime/config/telemetry systems projections. |
| Browser automation becomes an unsupported Chat state/output channel | High | Limit the host launcher to opening the authenticated profile and submitting `run_id`; accept completion only through supported authenticated Control/MCP calls. |
| Host-local launcher bypasses the private data boundary | High | Keep PostgreSQL unpublished; use only the scoped HTTPS launcher-control endpoint and a dedicated token whose server stores only SHA-256. |
| One-VDS stack becomes operationally excessive | Medium | Keep optional Compose profiles and require the core profile to stand alone. |

## Resolved composition questions

- OpenClaw adapter boundaries are pinned and isolated from product authority.
- OpenClaw Office is presentation-only; AI World owns canonical World state.
- LiteLLM is the selected single model gateway; local/API models remain Routes.
- Graphiti/FalkorDB and Langfuse are optional projections, not product sources of
  truth.
- Native Chat uses supported OAuth/MCP Control semantics and never treats DOM
  output as completion evidence.
