# Product acceptance audit — 2026-08-18

This is the authoritative current-state acceptance matrix for AI World after the
production-activation regression pass. `PASS` requires repository/runtime evidence
at the criterion scope. `PARTIAL` means implementation exists but a real owner or
environment proof is still required. `OPEN` means a required product surface is
absent.

Current product result: **22/24 PASS, 2/24 PARTIAL, 0/24 OPEN**.

This product score is not a release claim. At audit start the repository default
branch was `codex/phase-1-contracts` at
`8a58c88c8ddb60e8a792ec70ac189bec8ee6a0c4`, 25 commits ahead of the previous
fully audited green commit `0e34d0e7158fc28003d15c1304da4d93c325ef0d`.
PR #6 (`codex/production-activation-pass-2026-08-18`) is the release-candidate
line for this pass. Exact-head CI for the latest PR head is required before merge
or deployment; historical green evidence is not substituted for it.

## Current-pass findings

- The last default-branch commit introduced a Biome formatting regression in
  `apps/native-chat-auth/src/entrypoint.js`; exact-head CI exposed it and PR #6
  contains the formatter-only correction without changing retry semantics.
- Production ingress is the documented Caddy/DNS HTTPS path. Two temporary
  Pinggy validation workflows and the tracked ephemeral edge URL were obsolete
  production-facing state and are removed in PR #6.
- The Pinggy helper remains only as an explicit local-development tool and no
  longer writes an ephemeral URL into the repository.
- The isolated Native Chat Compose verifier now uses an AI World fixture origin
  rather than stale Recruiter Radar naming.
- Repository governance remains unusual: `codex/phase-1-contracts` is still the
  default branch and no `main` branch is present. This pass does not rewrite
  history or change the default branch automatically.

| # | Product criterion | Status | Current evidence / remaining gate |
|---:|---|---|---|
| 1 | Open one site | PASS | One Next.js owner application serves World, Command, Hub and overlays. |
| 2 | See animated AI World with all Agents | PASS | Canonical `/api/world` projection drives the OpenClaw Office presentation port; responsive browser coverage exists. |
| 3 | Switch to Command without another app | PASS | World and Command share the canonical read model. |
| 4 | Add a ChatGPT Account once | PARTIAL | OAuth grants, refresh rotation, isolated browser profiles and scoped launcher control are implemented; one real personal Plus MCP/App run through terminal `commit_result` is still required. |
| 5 | Add API provider/key | PASS | Owner-only provider credential flow stores encrypted secrets without plaintext reads. |
| 6 | See models without duplicates | PASS | Canonical Model plus Route identity is enforced. |
| 7 | Create Agent with role/instructions/skills/tools/memory/schedule/budget/preferences | PASS | Agent Template/Instance provisioning and related policies are implemented while Account remains distinct. |
| 8 | Give an Agent a Task on the map | PASS | World assignment persists through canonical Task/approval flows. |
| 9 | See Account/API/Model/Mode used | PASS | Run provenance is projected into product operations surfaces. |
| 10 | See real movement/status/handoff | PASS | Movement and activity cues are deterministic projections of durable runtime events. |
| 11 | Automatically hand a Task across Agents | PASS | Durable orchestration activates dependency-complete work with retry/review policy. |
| 12 | Shared context across Agents | PASS | Project-scoped Context Packs are persisted and transport-independent. |
| 13 | Save useful output to Action Graph | PASS | Canonical Task/Run nodes, edges and result summaries feed Operations. |
| 14 | Extract Memory candidates automatically | PASS | Structured results materialize provenance-linked AGENT_RESULT context and Memory Inbox candidates. |
| 15 | Manage the visual Memory network | PASS | Network, Timeline, Inbox and Accept/Merge/Reject are native product views. |
| 16 | Open a Memory node and see exact evidence | PASS | Memory details retain Context/Event/Run provenance and semantic text. |
| 17 | Configure an Agent schedule | PASS | Durable timezone/DST-aware schedule contracts and restart-safe polling are implemented. |
| 18 | Manage MCP/n8n/servers/SSH from the site | PARTIAL | Registry, credentials, health, bounded SSH/MCP/GitHub actions, approvals, allowlists and host-key pinning are implemented; one approved bounded operation against a real provisioned SSH host remains required. |
| 19 | See tokens/limits/context pressure and bounded cost signal | PASS | Usage buckets and context/broker signals distinguish evidence from estimates. |
| 20 | Automatically choose the rational Route | PASS | Resource Broker persists eligibility evidence, score inputs and route decisions. |
| 21 | Survive restart without Task/Run/context loss | PASS | PostgreSQL/runtime restart, checkpoints and backup/restore verifiers cover durable state. |
| 22 | Spend no LLM tokens on animation/chatter | PASS | World cues and handoff animation are deterministic and do not invoke decorative LLM chatter. |
| 23 | Do not send every Agent the full history | PASS | Lazy MCP/context pulls and compiler budgets exclude full transcripts by default. |
| 24 | Avoid third-party dashboards in normal work | PASS | World, Command, Hub, Memory and Observatory are native surfaces; integrations remain adapters/projections. |

## Exact-head release evidence

The complete CI workflow still contains eight release jobs: quality,
PostgreSQL/runtime, orchestration, OpenClaw, LiteLLM, Codex, browser/E2E and
container/Compose. The release decision must use the latest PR #6 head and its
corresponding workflow run. A superseded or historical run does not count.

The first PR #6 run correctly exposed the inherited Biome failure before
`typecheck`, unit tests and build could execute. That failure is repaired on the
candidate branch. The final audit result must therefore be read together with
the latest exact-head CI state, not the failed superseded run.

## External live gates

These are not replaceable by fixtures or deterministic CI:

1. **Native Plus Chat / criterion 4:** one real personal Plus AI World MCP/App
   session completing `run_id -> begin_run -> resource pulls -> progress ->
   commit_result`.
2. **SSH / criterion 18:** one approved bounded operation against a real
   provisioned SSH host using its configured pinned host-key fingerprint.
3. **Codex production activation:** one successful real ChatGPT-authenticated
   Codex Run recording terminal Account/Mode/thread/turn/model/sandbox/usage
   provenance. A deterministic Codex verifier or a prior allowance rejection is
   not a production success.

## Release decision

- **Repository implementation:** no known `OPEN` numbered criterion.
- **Product acceptance:** 22/24 PASS; criteria 4 and 18 remain PARTIAL pending
  real owner/environment evidence.
- **Temporary production edge dependency:** removed from the release candidate;
  Pinggy remains local-development-only.
- **Repository governance:** not normalized automatically; default branch remains
  `codex/phase-1-contracts` until a deliberate branch-policy decision is made.
- **Automated release matrix:** must be green on the latest PR #6 head before
  merge/deploy.
- **Production activation:** **NOT YET CLAIMED** until exact-head CI and all three
  external live gates above are proven.
