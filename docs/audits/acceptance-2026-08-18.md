# Product acceptance audit — 2026-08-18

This is the authoritative current-state acceptance matrix for AI World after the
production-activation regression, auth-edge hardening, dependency-maintenance and
live-acceptance preparation passes. `PASS` requires repository/runtime evidence
at the criterion scope. `PARTIAL` means implementation exists but a real owner or
environment proof is still required. `OPEN` means a required product surface is
absent.

Current product result: **22/24 PASS, 2/24 PARTIAL, 0/24 OPEN**.

This score is deliberately separate from production activation. The remaining
acceptance gaps are external live proofs and must not be replaced with fixtures,
historical runs, deterministic CI or visible Chat DOM output.

## Repository closure sequence

The repository-side closure is carried by PRs #6 through #9:

- PR #6 removed obsolete temporary Pinggy production-edge state, corrected the
  inherited Native Chat formatter regression and restored exact-tree release
  evidence.
- PR #7 hardened Native Chat auth rate-limit identity at the Caddy boundary by
  overwriting `X-Real-IP` with Caddy's computed client IP and added a Compose
  regression contract for that boundary.
- PR #8 synchronized the authoritative evidence/plan and raised only the browser
  CI whole-job timeout so Playwright system dependency installation cannot consume
  the complete E2E window. E2E assertions and visual-evidence requirements were
  not weakened.
- PR #9 is the final repository-side activation-preparation change set: read-only
  public production preflight, an owner live-acceptance runbook, one-year HSTS,
  explicit public `Server` header removal verification, and a workspace
  package-lock consistency gate. Its merge policy is a complete exact-head CI
  matrix. Final run/tree-equivalence evidence is recorded in the immutable PR #9
  audit trail rather than creating a self-invalidating post-green documentation
  commit.

## Dependency maintenance closure

Dependency maintenance was not blindly merged. Each update was rebased onto the
then-current default branch and required the full eight-job CI matrix before the
next update became the baseline:

- `oidc-provider` `9.11.1 -> 9.11.3`: PR #2, exact head
  `e444f7c017ea387f96a4d1df0c9adcb59e2c81d4`, CI run `32175451514`, 8/8 green.
  Its regenerated lockfile also exposed and removed stale PostgreSQL dependencies
  that remained attached to the Native Chat launcher lockfile entry after the
  launcher stopped using PostgreSQL directly.
- Next.js `16.3.0 -> 16.3.1`: PR #3, exact head
  `8c6d82f7e6801db60c56415a9727abe844f010bd`, CI run `32176613840`, 8/8 green,
  including production build, browser E2E/visual evidence and Compose.
- `@langchain/langgraph` `1.4.8 -> 1.4.10`: PR #5, exact head
  `c92a2624801c3f20928ea91b27d3be322f9f4e09`, CI run `32177355645`, 8/8 green
  on the Next.js 16.3.1 baseline, including orchestration and PostgreSQL/restart
  coverage for the checkpoint-serialization change.
- `@langchain/core` `1.1.48 -> 1.2.8`: PR #4, exact head
  `2844f366e49fe670443b6ed54911de68d1e846ef`, CI run `32177971551`, 8/8 green
  on LangGraph 1.4.10. The release's retry-classification behavior change was
  reviewed rather than assumed harmless: AI World does not use the changed
  LangChain retry middleware as product authority, while canonical Mission
  retry/review remains in AI World orchestration and passed the full orchestration,
  PostgreSQL/runtime and Compose matrix.

The resulting dependency baseline is merge commit
`f4180b549fb65db56d66f9fcaed312dd92280ed9`. PR #9 adds a deterministic
`npm run test:lockfile` CI gate so manifest/workspace lockfile drift fails the
quality job instead of being discovered incidentally by a future dependency PR.

## Current-pass findings

- Production ingress is the documented Caddy/DNS HTTPS path. Temporary Pinggy
  validation workflows and tracked ephemeral edge state are removed; the local
  helper remains development-only and no longer mutates the repository.
- Native Chat Compose verification uses an AI World fixture origin rather than
  stale Recruiter Radar naming.
- Native Chat auth binds pre-auth rate limiting/login throttling to the client IP
  supplied by the trusted Caddy edge rather than a client-controlled
  `X-Real-IP` header, and Compose verification enforces that proxy contract.
- The production Caddy edge now carries `Strict-Transport-Security:
  max-age=31536000`, removes the public `Server` header, and the Compose contract
  fails if either boundary disappears.
- A read-only production preflight checks live/readiness, HSTS/header behavior,
  RFC 9728 protected-resource metadata, isolated OAuth discovery, Authorization
  Code + refresh + public-client DCR + PKCE S256, public ES256 JWKS, MCP
  fail-closed challenge, configured bearer-protected launcher control and the
  bounded Custom GPT Actions fallback contract on one HTTPS origin.
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
| 4 | Add a ChatGPT Account once | PARTIAL | OAuth grants, refresh rotation, isolated browser profiles, scoped launcher control and public preflight are implemented; one real personal Plus MCP/App run through terminal `commit_result` is still required. |
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

The dependency baseline is green through the ordered exact-head matrices listed
above. The final repository-side PR #9 must additionally prove on its exact head:

- workspace manifest/package-lock consistency;
- dependency audit/signature verification, formatting/lint, typecheck, unit tests
  and production build;
- PostgreSQL migrations/runtime/restart coverage;
- orchestration, OpenClaw, LiteLLM and official Codex deterministic verifiers;
- responsive browser/E2E plus visual evidence upload;
- isolated container/Compose verification, including Caddy HSTS, public-header
  removal and the hardened Native Chat topology.

The successful PR #9 run, synthetic merge and actual merge tree equality are kept
in PR #9's immutable audit comment. Any later code-bearing change requires a new
exact-tree release matrix.

## External live gates

The exact operator sequence and evidence checklist is
[`docs/live-acceptance.md`](../live-acceptance.md). These gates are not replaceable
by fixtures or deterministic CI:

1. **Native Plus Chat / criterion 4:** one real personal Plus AI World MCP/App
   session completing `run_id -> begin_run -> bounded resource pulls -> progress
   -> commit_result`.
2. **SSH / criterion 18:** one approved bounded operation against a real
   provisioned SSH host using its configured pinned host-key fingerprint.
3. **Codex production activation:** one successful real ChatGPT-authenticated
   Codex Run recording terminal Account/Mode/thread/turn/model/sandbox/usage
   provenance. A deterministic Codex verifier or merely successful login status
   is not a production success.

## Release decision

- **Repository implementation:** no known `OPEN` numbered criterion.
- **Dependency maintenance:** closed on the ordered, fully verified baseline above.
- **Repository-side production preparation:** preflight, HSTS, lockfile drift
  detection and live-proof runbook are implemented in PR #9 and gated by its full
  exact-head matrix.
- **Product acceptance:** **22/24 PASS, 2/24 PARTIAL**; criteria 4 and 18 remain
  pending only on real owner/environment evidence.
- **Temporary production edge dependency:** removed; Pinggy is local-development
  only.
- **Repository governance:** default branch remains `codex/phase-1-contracts`;
  no automatic history/default-branch rewrite is performed.
- **Production activation:** **NOT YET CLAIMED** until all three external live
  gates above are proven in the real owner environment.
