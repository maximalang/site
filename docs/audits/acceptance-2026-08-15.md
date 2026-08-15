# Product acceptance audit — 2026-08-15

This is a current-state evidence map, not a completion claim. `PASS` requires a
product/runtime proof at the scope of the criterion. `PARTIAL` means a narrower
contract, store or UI exists but the end-to-end product behavior is not yet
proven. `OPEN` means the required product surface is absent.

| # | Product criterion | Status | Current authoritative evidence / remaining gap |
|---:|---|---|---|
| 1 | Open one site | PASS | The Next.js app serves World, Command, Hub and overlays from `/`; production standalone and Playwright smoke cover the same app. |
| 2 | See animated AI World with all Agents | PASS | `OpenClawOfficeWorld` renders the canonical `/api/world` projection; no second World backend exists. |
| 3 | Switch to Command without another app | PASS | `ControlCenter` switches World/Command over the shared read model. |
| 4 | Add a ChatGPT Account once | PARTIAL | The native Hub now creates or reuses the ChatGPT consumer Provider, creates a distinct `CHATGPT_INTERACTIVE` Account with Plus/Pro/Free subscription metadata and CHAT plus optional CODEX surfaces, refreshes the canonical snapshot, and hands the Account to Native Chat profile setup. Component, production HTTP and browser tests prove the product flow without conflating Account and Agent. The isolated OAuth lifecycle additionally proves PostgreSQL-persisted grants, compatibility with a cached ChatGPT request that omitted `offline_access`, application restart, refresh-token rotation and replay-family revocation. One real personal Plus MCP/App connection is still the external live gate. |
| 5 | Add API provider/key | PASS | Owner-only Hub/provider credential flow stores encrypted secrets and never returns plaintext. |
| 6 | See models without duplicates | PASS | Canonical Model plus multiple Route model is enforced in PostgreSQL and the Hub projection. |
| 7 | Create Agent with role, instructions, skills, tools, memory, schedule, budget and preferred execution | PASS | The native Hub atomically provisions one immutable Agent Template plus one project-scoped Agent Instance with role, instructions, skill/tool links and Agent-level memory-context, token-budget and preferred-mode policies. It then refreshes the canonical Hub snapshot, focuses the new Agent in the durable Schedule panel and offers a direct schedule action. Isolated PostgreSQL, production HTTP, component and five-viewport browser tests prove the path while Account remains a separate Resource Broker concern. |
| 8 | Give an Agent a Task on the map | PASS | World selection opens the Task drawer; canonical assignment and approvals are persisted. |
| 9 | See Account/API/Model/Mode used | PASS | Run provenance readers and Command surfaces expose canonical execution provenance without credentials. |
| 10 | See real movement/status/handoff | PASS | Real status drives deterministic movement and activity cues. A dependency-complete Run now creates one provenance-linked PostgreSQL handoff, advances the canonical World stream and projects a bounded map path plus a textual `Agent → Agent` cue. The isolated PostgreSQL verifier proves persistence/projection, while unit and five-viewport Playwright/axe suites prove the accessible World presentation without decorative LLM calls. |
| 11 | Automatically hand a Task across Agents | PASS | LangGraph decisions and dependency-aware Mission Tasks feed a restart-safe supervisor. `REVIEW_EACH_TASK` is the migration-safe default; an explicit PostgreSQL `AUTO_SAFE_HANDOFF` Mission policy repeatedly selects only activated dependency-complete Tasks, invokes the shared approval/Resource Broker boundary with a deterministic command ID and leaves the shared Run supervisor to dispatch the selected adapter. The isolated PostgreSQL verifier proves one downstream Run, exact replay and no residual candidate. |
| 12 | Shared context across Agents | PASS | PostgreSQL/pgvector Context Packs are project-scoped, persisted per Run and transport-independent. |
| 13 | Save useful output to Action Graph | PASS | Owner-only `/api/operations` projects bounded canonical Task/Run nodes, execution/handoff edges and persisted Codex or Native Chat structured-result summaries from PostgreSQL. The native Hub Operations panel exposes the same graph in Simple/Advanced modes; isolated PostgreSQL, route, component and five-viewport browser tests cover the path. |
| 14 | Extract Memory candidates automatically | PASS | Native Chat `commit_result` creates provenance-linked Memory Inbox proposals transactionally. |
| 15 | Manage the visual Memory network | PASS | Network, Timeline and Inbox plus Accept/Merge/Reject are product-native views. |
| 16 | Open a Memory node and see exact evidence | PASS | Advanced Memory details preserve canonical Context/Event/Run provenance. |
| 17 | Configure an Agent schedule | PASS | Strict Agent schedule contracts, timezone/DST-aware recurrence, PostgreSQL schedules/firings, atomic Task + approval + World-event materialization, restart-safe polling and the owner-only Hub Simple/Advanced UI are proven by 5 real isolated-PostgreSQL schedule scenarios, standalone restart verification, unit tests and five-viewport Playwright/axe tests. Account and transport are intentionally absent from schedule intent. |
| 18 | Manage MCP/n8n/servers/SSH from the site | PARTIAL | The owner-only Hub registry creates, lists, enables, disables and explicitly tests MCP, n8n, GitHub and SSH endpoints. A `READY` integration now exposes a predefined read-only action: MCP `tools/list`, n8n workflow list, GitHub repository list or SSH host inspection. Exact-host allowlisting, reserved-address blocking, private-network acknowledgement, pinned DNS, no redirects, bounded normalized output, encrypted/write-only credentials and durable PostgreSQL action replay are enforced. Isolated production HTTP proves the action receipt and restart-safe replay. Approval-gated write/workflow-trigger/shell/deploy actions remain the gap; arbitrary remote execution is intentionally not exposed. |
| 19 | See tokens/limits/cost/context pressure | PARTIAL | The native Operations Observatory now shows persisted Codex input/cached/output tokens, aggregate Context Pack pressure and fresh/stale Broker quality, remaining-limit, speed, load and cost-efficiency signals. Actual monetary spend is deliberately shown as unavailable because no authoritative spend source is integrated yet; that missing source is the remaining gap. |
| 20 | Automatically choose the rational Route | PASS | Resource Broker scores fresh quality, limits, cost, latency and load evidence and appends its exact decision event. |
| 21 | Survive restart without Task/Run/context loss | PASS | Isolated PostgreSQL, standalone restart, LangGraph checkpoint and Compose backup/restore verifiers cover the durable boundaries. |
| 22 | Spend no LLM tokens on animation/chatter | PASS | World cues are deterministic projections; structured meetings prohibit transcript/chatter fields. |
| 23 | Do not send every Agent the full history | PASS | Lazy MCP pulls and ContextCompiler category/token limits exclude full transcripts by default. |
| 24 | Avoid third-party dashboards in normal work | PASS | World, Command, Hub and Memory are native product surfaces; LiteLLM/Graphiti/OpenClaw dashboards are not exposed. |

## Production preflight evidence

The isolated production Compose verifier passed on the current head
`49b63f07e7dcb760d912ad03d2de3f0a56c6ed9f`. It created a unique disposable
Compose project, exercised HTTPS, readiness degradation, a real PostgreSQL
backup/mutation/restore cycle, non-root and read-only containers, private
database/model-gateway/Codex-worker boundaries, separated Codex authentication,
the configured CA boundary and pinned Codex CLI `0.147.0`, then removed its
containers, volumes and temporary backup directory. This evidence does not
substitute for the two account-bound live gates below.

## External live gates

- A real AI World MCP/App connection from personal Plus must complete
  `run_id -> begin/pull -> commit_result`; until then `CHAT` remains
  non-selectable.
- `codex login status` and one real ChatGPT-authenticated Codex Run must record
  Account/Mode/thread/turn/model/sandbox/usage provenance. The deterministic
  official SDK/CLI verifier is necessary but not sufficient for this gate.

## Next implementation order

1. Add policy- and approval-gated predefined integration actions for n8n,
   GitHub and SSH/VDS; do not expose arbitrary remote commands.
2. Integrate an authoritative monetary-spend source where a configured provider
   exposes one; preserve `unknown` instead of estimating unsupported spend.
3. Run the two account-bound live gates and repeat the full browser/runtime
   suite against the final head.
