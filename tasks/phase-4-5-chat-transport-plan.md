# Phase 4.5 Plan: Native Chat integration and resource routing

## Outcome

Make `CHAT` a native ChatGPT execution surface while AI World remains the sole
owner of Missions, Tasks, Runs, context, memory, orchestration and history. A
minimal on-demand browser launcher selects the configured Account, creates a
Chat and sends only `run_id`. It never reads output, waits for a final response,
scrapes the DOM, copies cookies or calls private ChatGPT endpoints.

The Chat agent pulls only the resources it actually needs and writes progress
and the terminal structured result through the same AI World Control API used
by a Custom GPT Action today and an AI World App/Plugin when Plus write support
is available and verified.

## Current upstream boundary (refreshed 2026-08-14)

- Custom GPTs are available on Plus and Actions call external APIs described by
  OpenAPI with API-key or OAuth authentication. This is the current supported
  implementation path for personal Plus accounts.
- Full custom MCP write apps are currently documented for Business,
  Enterprise and Edu, not personal Plus. The App/Plugin adapter remains the
  target, but must stay capability-gated and experimental until OpenAI exposes
  and a live verifier proves the required Plus write surface.
- ChatGPT can request confirmation for external writes. AI World must model this
  as an execution condition; it must not bypass or conceal the confirmation.

Sources:

- <https://help.openai.com/en/articles/9442513>
- <https://help.openai.com/en/articles/8554397-creating-a-gpt>
- <https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>

## Fixed architecture

```text
Mission -> Tasks -> Runs -> Resource Broker -> independent Transport
                                      |
                         on-demand Chat launcher sends run_id
                                      |
                   ChatGPT pulls context and commits Control events
                                      |
                   PostgreSQL append-only canonical event log
                     |          |          |           |
               Action Graph   World     Memory      replay
```

- `Agent != Account`. `AgentTemplate` defines reusable behavior;
  `AgentInstance` binds a template to a Mission/project, and `Run` is one
  execution attempt. ChatGPT identities map to canonical Accounts only.
- `ChatTransport`, `WorkTransport`, `CodexTransport`, API and Local adapters are
  independent. The Resource Broker chooses among eligible candidates using
  quality, limits, cost, speed and load; policy or owner overrides remain
  explicit and most UI controls default to `Auto`.
- Native Plus Chat dispatch is `BROWSER_ON_DEMAND`; its result channel is
  `CONTROL_API`. Browser submission is evidence of dispatch, never evidence of
  execution or success.
- `run_id` is an address, not a credential. OAuth/authenticated app identity
  selects one canonical Account; authorization is capability-scoped to the Run.
- Initial Chat input is intentionally minimal. Project state, memory, RAG,
  skills, artifacts and history are bounded lazy pulls with provenance and
  token budgets enforced by Context/Token Governor.
- The agent calls `begin_run`, may emit `heartbeat`, `finding`, `artifact`,
  `decision`, `handoff` or `fail`, and must call
  `commit_result(run_id, structured_result)` before its final Chat message.
- Only authenticated backend events change canonical Run state. A visible Chat
  answer, browser navigation or DOM state cannot complete a Run.
- The append-only PostgreSQL event log is the source for Action Graph, World
  state, history and replay. World animation is a deterministic projection and
  never invokes an LLM.
- LangGraph owns durable orchestration, checkpoints, recovery, retries,
  handoffs and review loops behind product-owned workflow interfaces.
- Structured meetings record bounded positions, one synthesis and one decision;
  free-form multi-agent chatter is not orchestration.
- Memory Center projects Network, Timeline and Inbox. Curator proposals require
  explicit `Accept`, `Merge` or `Reject`, retaining provenance for every choice.
- Settings expose `Simple` and `Advanced`; `Simple` uses safe `Auto` defaults.
- Reuse OpenClaw, Agent Town, LiteLLM, LangGraph, Graphiti/FalkorDB,
  PostgreSQL/pgvector, Langfuse, n8n and MCP. Product-owned code is limited to
  AI World UI, Unified Hub, Resource Broker, Context/Token Governor, shared
  Event/Memory layer and Native Chat integration.

## Slice 1: Contracts and product truth

- [x] Replace relay/import contracts with dispatch-only Native Chat contracts.
- [x] Define bounded lazy resource pulls and structured Control events.
- [x] Enforce ordered events, `begin_run` before progress and terminal
      `commit_result`/`fail` with no post-terminal writes.
- [x] Keep CHAT experimental and non-selectable until implementation and live
      evidence exist; never label manual relay as the primary transport.
- [ ] Define additive Mission, AgentTemplate/Instance and Resource Broker
      contracts without breaking existing Agent/Task records.

## Slice 2: Canonical event and Control API

- [ ] Persist dispatches and authenticated Control events atomically in
      PostgreSQL with per-Run sequence and idempotency conflict detection.
- [ ] Expose OAuth-protected `begin_run`, bounded pull endpoints and event tools;
      derive Account from auth instead of trusting request fields.
- [ ] Update Task/Run, Action Graph, World projections and Memory Inbox from the
      same committed transaction/outbox boundary.
- [ ] Reconcile restart, late/duplicate calls, missing commit and expired
      capabilities deterministically.

## Slice 3: Plus launcher and Actions adapter

- [ ] Isolated on-demand launcher selects an already authenticated Account,
      opens the configured Custom GPT/new Chat and submits only `run_id`.
- [ ] No DOM output read, final-response wait, cookie access or private API.
- [ ] Publish one OpenAPI contract for Custom GPT Actions using the Control API;
      each ChatGPT account connects through its own OAuth identity to the same
      AI World owner/control plane.
- [ ] Add an MCP/App adapter over the same use cases without a second state
      store or orchestration path.

## Slice 4: Resource Broker and durable orchestration

- [ ] Score eligible Account/Chat/Work/Codex/API/Local candidates from fresh
      quality, remaining limits, marginal cost, latency and load observations.
- [ ] Fail closed on stale quota/auth/capability evidence; record the selected
      candidate, score inputs, policy version and fallback reason as events.
- [ ] LangGraph checkpoints reference canonical Mission/Task/Run/Event IDs and
      resume without duplicating side effects.
- [ ] Mission decomposition and structured meetings produce bounded Tasks,
      synthesis, decision and success-criteria evidence.

## Verification gate

- Contract tests reject extra launcher content, forged Account fields,
  oversized pulls, skipped sequences, commit-before-begin, duplicate conflicts
  and post-terminal writes.
- Disposable PostgreSQL tests prove idempotency, ordered replay, restart and
  exact provenance.
- Browser verifier proves only `run_id` is submitted and no response DOM is
  observed on each supported account profile.
- A real Plus Custom GPT + Actions run must commit through the Control API before
  CHAT becomes selectable. The App/Plugin path stays experimental until the
  exact personal Plus write capability is officially available and live-proven.
