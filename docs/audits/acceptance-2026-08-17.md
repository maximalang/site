# Product acceptance audit — 2026-08-17

This is the authoritative current-state acceptance matrix for AI World. `PASS`
requires product/runtime evidence at the scope of the criterion. `PARTIAL`
means the repository implementation is present but a real owner/environment
proof is still required. `OPEN` means a required product surface is absent.

Current result: **22/24 PASS, 2/24 PARTIAL, 0/24 OPEN**.

The full CI matrix for commit `0e34d0e7158fc28003d15c1304da4d93c325ef0d`
passed all eight jobs: quality (audit, signatures, lint, typecheck, unit tests,
build), PostgreSQL/runtime, browser/E2E plus visual evidence, container/Compose,
orchestration, OpenClaw, LiteLLM and Codex.

AI World is an owner-operated control shell, not a customer commerce surface.
Checkout, payment collection, invoice presentation and provider-billing
reconciliation remain intentionally outside product scope. Operational cost
signals are shown only as clearly labelled estimates when runtime providers
supply them.

| # | Product criterion | Status | Authoritative evidence / remaining gate |
|---:|---|---|---|
| 1 | Open one site | PASS | One Next.js application serves World, Command, Hub and overlays; standalone production smoke and five browser projects exercise the same app. |
| 2 | See animated AI World with all Agents | PASS | `OpenClawOfficeWorld` renders the canonical `/api/world` projection. OpenClaw Office presentation primitives are ported without its backend/store. Desktop, laptop, tablet, compact and mobile visual evidence covers the World and reduced-motion behavior. |
| 3 | Switch to Command without another app | PASS | `ControlCenter` switches World/Command over the shared canonical read model. |
| 4 | Add a ChatGPT Account once | PARTIAL | Hub creates/reuses the consumer Provider and a distinct `CHATGPT_INTERACTIVE` Account with CHAT plus optional CODEX surfaces; PostgreSQL OAuth grants, refresh rotation and replay-family revocation are implemented. The host-local launcher now reaches the private queue only through `/api/native-chat-launcher` with a fixed launcher ID and a server-stored SHA-256 bearer-token verifier; it no longer needs PostgreSQL credentials. One real personal Plus MCP/App connection and terminal `commit_result` remains an external live gate. |
| 5 | Add API provider/key | PASS | Owner-only Hub/provider credential flow stores encrypted secrets and never returns plaintext. |
| 6 | See models without duplicates | PASS | Canonical Model plus multiple Route identity is enforced in PostgreSQL and Hub projections. |
| 7 | Create Agent with role, instructions, skills, tools, memory, schedule, budget and preferred execution | PASS | Hub atomically provisions Agent Template plus project-scoped Agent Instance, links skills/tools, memory/context and execution policy, then exposes schedule configuration. PostgreSQL, HTTP, component and responsive browser tests cover the flow while Accounts remain separate. |
| 8 | Give an Agent a Task on the map | PASS | World selection opens the Task flow; assignment and approvals persist canonically. |
| 9 | See Account/API/Model/Mode used | PASS | Run provenance readers and Command/Operations surfaces expose execution provenance without credentials. |
| 10 | See real movement/status/handoff | PASS | Runtime status and durable handoff events drive deterministic movement/activity cues and bounded `Agent → Agent` paths; PostgreSQL and browser evidence cover persistence and presentation. |
| 11 | Automatically hand a Task across Agents | PASS | LangGraph plus the restart-safe handoff supervisor activates dependency-complete Tasks, honors review/auto-safe policy and routes approval through the shared Resource Broker boundary without duplicate Runs. |
| 12 | Shared context across Agents | PASS | PostgreSQL/pgvector Context Packs are project-scoped, persisted per Run and transport-independent. |
| 13 | Save useful output to Action Graph | PASS | `/api/operations` projects canonical Task/Run nodes, execution/handoff edges and persisted adapter result summaries; Hub Operations displays the same graph. |
| 14 | Extract Memory candidates automatically | PASS | Structured Native Chat/API/Local results materialize provenance-linked AGENT_RESULT context plus Memory Inbox proposals/events; unstructured text is retained only as result evidence. |
| 15 | Manage the visual Memory network | PASS | Network, Timeline and Inbox plus Accept/Merge/Reject are native product views. Memory Network visual evidence is verified across five viewports. |
| 16 | Open a Memory node and see exact evidence | PASS | Advanced Memory details retain canonical Context/Event/Run provenance and full semantic text. |
| 17 | Configure an Agent schedule | PASS | Strict schedule contracts, timezone/DST recurrence, durable firings, Task/approval materialization and restart-safe polling are covered by PostgreSQL, runtime, unit and browser tests. |
| 18 | Manage MCP/n8n/servers/SSH from the site | PARTIAL | Hub registry, credentials, health probes, bounded MCP/GitHub/SSH actions, explicit mutation approvals, host allowlists, DNS/host-key pinning, output bounds and durable outcome states are implemented and tested. No raw SSH command/PTTY surface exists. One operation against a real provisioned SSH host with its pinned fingerprint remains an external live gate. |
| 19 | See tokens/limits/context pressure and bounded cost signal | PASS | Operations aggregates Codex/API/Local token usage, Context Pack pressure and Broker signals. LiteLLM response cost is explicitly an estimate; absent cost remains unknown. |
| 20 | Automatically choose the rational Route | PASS | Resource Broker persists fresh evidence, score inputs and decisions; durable API_MODEL/LOCAL_MODEL adapters, LiteLLM projection/fallback constraints and paid-call idempotency/replay are verified. |
| 21 | Survive restart without Task/Run/context loss | PASS | PostgreSQL/runtime restart, LangGraph checkpoint and isolated Compose backup/restore verifiers cover durable state boundaries. |
| 22 | Spend no LLM tokens on animation/chatter | PASS | World cues are deterministic projections and structured meetings prohibit free-form transcript/chatter fields. |
| 23 | Do not send every Agent the full history | PASS | Lazy MCP resource pulls and ContextCompiler category/token limits exclude full transcripts by default. |
| 24 | Avoid third-party dashboards in normal work | PASS | World, Command, Hub, Memory and Observatory are product-native surfaces; LiteLLM, Graphiti, Langfuse and OpenClaw remain infrastructure/projections. |

## Production preflight evidence

The current isolated Compose verifier proves HTTPS, readiness/degradation,
private PostgreSQL/model/Codex boundaries, non-root/read-only containers and a
real backup/mutation/restore cycle. PostgreSQL/runtime verification covers the
canonical stores and restart behavior. Browser CI uploads responsive visual
evidence. Dependency audit and package-signature verification are green.

The Native Chat laptop boundary is now production-shaped rather than a direct
DB shortcut: Caddy routes `/api/native-chat-launcher` to web over HTTPS; web
keeps PostgreSQL private, authenticates a dedicated random bearer token by its
SHA-256 verifier using a timing-safe comparison, binds all queue operations to
the configured launcher ID and server clock, and validates bounded action
bodies. The laptop reads the raw token only from a dedicated absolute regular
file. Token bootstrap refuses overwrite/symlink parents and does not print the
raw token.

## External live gates

These are deliberately not replaced with fixtures or marked PASS from CI:

1. **Native Plus Chat / criterion 4:** connect one real personal Plus AI World
   MCP/App session and complete `run_id -> begin/pull -> commit_result`. Until
   this is proven, CHAT remains unavailable/non-selectable in production.
2. **SSH / criterion 18:** execute one approved bounded operation against a real
   provisioned host using the configured pinned host-key fingerprint.
3. **Codex production activation (outside the 24-item matrix):** the persisted
   worker state has returned `Logged in using ChatGPT` and the official
   deterministic SDK/CLI verifier passes, but one successful real
   ChatGPT-authenticated Codex Run must still record terminal Account/Mode/
   thread/turn/model/sandbox/usage provenance. The prior real turn reached
   ChatGPT but was rejected by the account's separate Codex usage allowance, so
   no successful production Run is claimed.

The Timeweb MCP wrapper's authenticated read after refresh-token repair remains
separate infrastructure evidence and is not evidence for the AI World Plus
MCP/App gate.

## Release decision

- **Repository implementation:** no known OPEN product criterion.
- **Automated release matrix:** green at the commit recorded above.
- **Product acceptance:** 22/24 PASS; criteria 4 and 18 require external live
  evidence.
- **Production activation:** not yet claimed until those two acceptance gates
  and the real owner-authenticated Codex Run are proven.
- **Deployment:** intentionally not performed as part of this audit.
