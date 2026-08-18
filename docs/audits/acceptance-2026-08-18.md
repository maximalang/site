# Product acceptance audit — 2026-08-18

This is the authoritative current-state acceptance matrix for AI World after the
production-activation regression and auth-edge hardening passes. `PASS` requires
repository/runtime evidence at the criterion scope. `PARTIAL` means implementation
exists but a real owner or environment proof is still required. `OPEN` means a
required product surface is absent.

Current product result: **22/24 PASS, 2/24 PARTIAL, 0/24 OPEN**.

The latest code-bearing production hardening is merged. PR #6 removed obsolete
temporary production-edge state, fixed the inherited formatter regression and
re-established exact-tree release evidence. PR #7 then hardened Native Chat auth
rate-limit identity at the Caddy boundary by overwriting `X-Real-IP` with Caddy's
computed client IP and added a Compose regression contract for that boundary.

PR #7 head `19d16bd85f8c5a8a9eb1f98e3a4d5fc49f47cd79` passed the complete eight-job CI
workflow in run `32171862239`: quality, PostgreSQL/runtime, orchestration,
OpenClaw, LiteLLM, Codex deterministic verification, browser/E2E plus visual
evidence, and container/Compose. GitHub tested synthetic merge commit
`d7e58d52c87527d3f12c68ac8debb9401b757921`; the actual merge commit
`4c565936dd12427516f6ba7aadddf614f6a9c931` has the same tree SHA
`a44620f06137fd4e2e154e44f7925856bdc30463`. Therefore the code-bearing tree
merged to the default branch is exactly the tree validated by the successful
full CI matrix.

This product score is still not a production-activation claim. The remaining
acceptance gaps are external live proofs and must not be replaced with fixtures,
historical runs or deterministic CI.

## Current-pass findings

- The inherited Biome formatting regression in Native Chat auth startup was
  exposed by exact-head CI and corrected without changing retry semantics.
- Production ingress is the documented Caddy/DNS HTTPS path. Temporary Pinggy
  validation workflows and tracked ephemeral edge state were removed; the local
  helper remains development-only and no longer mutates the repository.
- Native Chat Compose verification uses an AI World fixture origin rather than
  stale Recruiter Radar naming.
- Native Chat auth now binds pre-auth rate limiting/login throttling to the client
  IP supplied by the trusted Caddy edge rather than a client-controlled
  `X-Real-IP` header, and Compose verification enforces that proxy contract.
- Repository-wide review found no known `TODO`, `FIXME`, `Not implemented` or
  placeholder product implementation tail.
- SSH mutation execution is implemented through `ssh2`, no PTY, bounded output,
  host allowlisting, explicit private-network acknowledgement, SHA-256 host-key
  pinning and registered operation schemas whose command-bearing fields exclude
  shell metacharacters/traversal.
- Integration mutations remain approval-gated and durable: request, explicit
  approve/deny decision, execution and terminal result are persisted with
  idempotency/conflict checks and runtime readiness revalidation.
- Repository governance remains unusual: `codex/phase-1-contracts` is the default
  branch and no `main` branch is present. This audit does not rewrite history or
  change the default branch automatically.

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

## Automated release evidence

The complete code-bearing release matrix is green. CI run `32171862239` completed
successfully on the PR #7 synthetic merge tree, including:

- dependency audit/signature verification, formatting/lint, typecheck, unit tests
  and production build;
- PostgreSQL migrations/runtime/restart coverage;
- orchestration, OpenClaw, LiteLLM and official Codex deterministic verifiers;
- responsive browser/E2E plus visual evidence upload;
- isolated container/Compose verification, including the hardened Caddy/Native
  Chat topology.

The actual PR #7 merge commit carries the identical tree SHA, so no code delta
exists between the tree CI validated and the code-bearing tree merged to the
default branch. Subsequent documentation-only evidence maintenance does not
replace or weaken this proof; any new code-bearing change requires a new
exact-tree release matrix.

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

## Maintenance outside acceptance

Open Dependabot pull requests are dependency-maintenance work, not evidence that
a numbered product criterion is missing. They are intentionally not folded into
this production-closure pass without fresh compatibility review. In particular,
the proposed `@langchain/core` update includes retry-behavior changes and must not
be treated as a blind patch-only upgrade. Current release CI dependency audit and
registry-signature verification are green.

## Release decision

- **Repository implementation:** no known `OPEN` numbered criterion.
- **Automated code-bearing release matrix:** **GREEN** on the exact tree merged by
  PR #7.
- **Product acceptance:** **22/24 PASS, 2/24 PARTIAL**; criteria 4 and 18 remain
  pending only on real owner/environment evidence.
- **Temporary production edge dependency:** removed; Pinggy is local-development
  only.
- **Auth edge:** hardened and Compose-verified.
- **Repository governance:** default branch remains `codex/phase-1-contracts`;
  no automatic history/default-branch rewrite was performed.
- **Production activation:** **NOT YET CLAIMED** until all three external live
  gates above are proven in the real owner environment.
