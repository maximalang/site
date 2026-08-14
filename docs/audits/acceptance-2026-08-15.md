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
| 4 | Add a ChatGPT Account once | PARTIAL | Canonical Account commands and Native Chat OAuth mapping exist; a complete owner UI and real Plus connection proof remain. |
| 5 | Add API provider/key | PASS | Owner-only Hub/provider credential flow stores encrypted secrets and never returns plaintext. |
| 6 | See models without duplicates | PASS | Canonical Model plus multiple Route model is enforced in PostgreSQL and the Hub projection. |
| 7 | Create Agent with role, instructions, skills, tools, memory, schedule, budget and preferred execution | PARTIAL | Agent/Template, skills/tools and inherited execution preferences exist. Schedule and an integrated creation flow for every listed setting remain open. |
| 8 | Give an Agent a Task on the map | PASS | World selection opens the Task drawer; canonical assignment and approvals are persisted. |
| 9 | See Account/API/Model/Mode used | PASS | Run provenance readers and Command surfaces expose canonical execution provenance without credentials. |
| 10 | See real movement/status/handoff | PARTIAL | Real status and deterministic activity cues drive movement. End-to-end automatic handoff animation is not yet proven. |
| 11 | Automatically hand a Task across Agents | PARTIAL | LangGraph decisions, dependency-aware Mission Tasks and structured handoff data exist; the production action executor does not yet dispatch the next dependency automatically. |
| 12 | Shared context across Agents | PASS | PostgreSQL/pgvector Context Packs are project-scoped, persisted per Run and transport-independent. |
| 13 | Save useful output to Action Graph | PARTIAL | Native Chat commits and Codex events persist structured output and append-only events. One unified user-facing Action Graph projection remains open. |
| 14 | Extract Memory candidates automatically | PASS | Native Chat `commit_result` creates provenance-linked Memory Inbox proposals transactionally. |
| 15 | Manage the visual Memory network | PASS | Network, Timeline and Inbox plus Accept/Merge/Reject are product-native views. |
| 16 | Open a Memory node and see exact evidence | PASS | Advanced Memory details preserve canonical Context/Event/Run provenance. |
| 17 | Configure an Agent schedule | OPEN | No canonical schedule domain/store/supervisor/UI exists. |
| 18 | Manage MCP/n8n/servers/SSH from the site | OPEN | Native Chat MCP exists, but the unified integrations/server management surface and n8n/SSH adapters do not. |
| 19 | See tokens/limits/cost/context pressure | PARTIAL | Usage, Context Pack budgets and Broker quota observations are persisted; the unified Observatory/UI is missing. |
| 20 | Automatically choose the rational Route | PASS | Resource Broker scores fresh quality, limits, cost, latency and load evidence and appends its exact decision event. |
| 21 | Survive restart without Task/Run/context loss | PASS | Isolated PostgreSQL, standalone restart, LangGraph checkpoint and Compose backup/restore verifiers cover the durable boundaries. |
| 22 | Spend no LLM tokens on animation/chatter | PASS | World cues are deterministic projections; structured meetings prohibit transcript/chatter fields. |
| 23 | Do not send every Agent the full history | PASS | Lazy MCP pulls and ContextCompiler category/token limits exclude full transcripts by default. |
| 24 | Avoid third-party dashboards in normal work | PASS | World, Command, Hub and Memory are native product surfaces; LiteLLM/Graphiti/OpenClaw dashboards are not exposed. |

## External live gates

- A real AI World MCP/App connection from personal Plus must complete
  `run_id -> begin/pull -> commit_result`; until then `CHAT` remains
  non-selectable.
- `codex login status` and one real ChatGPT-authenticated Codex Run must record
  Account/Mode/thread/turn/model/sandbox/usage provenance. The deterministic
  official SDK/CLI verifier is necessary but not sufficient for this gate.

## Next implementation order

1. Canonical Agent schedules and restart-safe scheduler.
2. Dependency/handoff action executor for LangGraph Mission Tasks.
3. Product Action Graph/usage/limits/cost/context-pressure Observatory.
4. Product-native integrations registry for MCP, n8n, GitHub and SSH/VDS.
5. Full Playwright/Compose/live-gate rerun and criterion-by-criterion closure.
