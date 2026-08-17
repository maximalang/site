# Phase 4 Plan: Official Codex Execution

## Outcome

Execute repository-focused Tasks through the official Codex SDK as the
specialist `CODEX` ExecutionAdapter. Canonical Agent, Account, Session, Task,
Run, approval and routing state remains PostgreSQL-owned. A Codex thread is an
external execution-session reference, never an Agent or Account identity.

## Current upstream evidence

- Pin `@openai/codex-sdk` and its exact `@openai/codex` runtime dependency to
  `0.147.0` (Apache-2.0, Node >=18). Registry integrity for the SDK is
  `sha512-nJL0maDBZy31uEArs+u46tW22veNdHjfs96AGaFTnI3jF+g8U+a422uaPiDZwEKmyxcNwStTRz6sIh6C7XxGFQ==`.
- The official TypeScript SDK starts, continues and resumes local Codex threads
  and wraps the official CLI JSONL transport. It is server-side only.
- Official local authentication supports ChatGPT browser login and API keys.
  ChatGPT login is performed by `codex login`; device-code login is the
  documented beta path for headless hosts.
- Cached credentials are owned by Codex. Prefer
  `cli_auth_credentials_store = "keyring"`; never read, parse, copy, log or
  return `auth.json` or its tokens through product code.

Sources refreshed 2026-08-13:

- <https://developers.openai.com/codex/sdk/>
- <https://developers.openai.com/codex/auth/>
- <https://github.com/openai/codex/blob/main/sdk/typescript/README.md>

## Fixed boundaries

- Use only the official SDK/CLI transport. Direct app-server WebSocket and
  browser/DOM automation of consumer ChatGPT are not production dependencies.
- `CodexExecutionAdapter` implements the existing versioned execution boundary;
  callers never import SDK types.
- Each run receives an explicit repository working directory, sandbox,
  approval policy, network policy and bounded timeout. The adapter cannot make
  policy less restrictive than the canonical route/run request.
- The SDK receives an allowlisted minimal environment. Unrelated process
  secrets are not inherited.
- PostgreSQL owns dispatch/idempotency and terminal state. SDK thread IDs,
  turn IDs and usage are external provenance only.
- Raw SDK events are bounded, schema-normalized and persisted before projection.
  Final output capture is transport-neutral so later context/memory phases do
  not depend on Codex event shapes.
- Chat and Work remain separate native transport capabilities with explicit
  `UNSUPPORTED` status until an official supported integration exists.

## Slice 1: Adapter contract and SDK facade

Add a small `@agent-world/codex-adapter` package. Define strict execution
request, receipt, observation, normalized event, usage and failure schemas.
Wrap the official SDK behind an injectable facade for deterministic contract
tests while preserving the existing `TaskExecutionAdapter` surface.

- [x] Adapter identity is exactly `CODEX` and no SDK type crosses its boundary.
- [x] Agent, Account, Session and Codex thread identities remain distinct.
- [x] Timeout, cancellation, auth, sandbox, malformed event and SDK failures
      normalize without raw output or credential leakage.
- [x] Duplicate dispatch uses canonical idempotency and never creates a second
      Codex turn.

## Slice 2: Durable execution ledger

Add an additive PostgreSQL ledger/outbox for specialist executions and
normalized events. Claim work with bounded leases, preserve exact external
thread/turn provenance and reconcile an interrupted worker without losing or
double-running a canonical Run.

- [x] Enqueue and claim are transactional, tenant-safe and idempotent.
- [x] Event sequence is monotonic per Run and duplicate SDK events are ignored.
- [x] Restart leaves queued/running work recoverable with an explicit outcome.
- [x] Final output and token usage are stored as bounded evidence, not memory.

## Slice 3: Isolated Codex worker

Run the SDK in a private, resource-bounded worker rather than inside the public
web process. Mount only the selected project root plus a dedicated Codex state
location; keep the web and database private-network posture intact.

- [x] Worker runs non-root with no host port and a read-only root filesystem.
- [x] Repository paths resolve inside explicit allowlisted roots and reject
      traversal, symlink escape and non-Git roots.
- [x] Default execution is workspace-write, approval on request, network off;
      broader permissions require an approved canonical policy decision.
- [x] Health distinguishes worker availability from authentication readiness.

## Slice 4: Official SDK live proof

Exercise the exact pinned SDK/runtime against a deterministic local
OpenAI-compatible test endpoint for protocol/stream proof, then separately run
an authenticated ChatGPT Codex turn using Codex-owned credentials without ever
reading them.

- [x] Pinned SDK launches its pinned official CLI and emits real JSONL events.
- [x] Deterministic live proof covers progress, final output, usage and failure.
- [x] `codex login status` proves the configured method without exposing tokens.
- [ ] A real ChatGPT-authenticated Codex run records Account/Mode/thread/turn,
      sandbox, model and usage provenance in PostgreSQL.

The persisted Codex worker state returned `Logged in using ChatGPT` on
2026-08-17. A subsequent official CLI bootstrap reached ChatGPT and created a
real thread, but the turn was rejected because that account's separate Codex
usage allowance was exhausted until 2026-08-20 13:13. This proves auth readiness
without satisfying the successful-Run gate above.

## Slice 5: Product flow and native-surface status

Expose Codex route readiness and execution provenance through the existing Hub,
Task and Command surfaces. Add transport capability records for Chat, Work and
Codex without third-party dashboards or unsupported automation.

- [x] Owner can associate a ChatGPT-interactive Account with a Codex route once.
- [x] Task routing to Codex requires an eligible Account, route and worker.
- [x] Command shows real Run status and Codex provenance without raw credentials.
- [x] Chat and Work show accurate official/experimental/unsupported/disabled
      status and cannot be selected when unsupported.

## Verification gate

- Unit, type, lint and build gates pass for every adapter failure class.
- Disposable PostgreSQL verification proves idempotency, leases, normalized
  events, output evidence and restart recovery.
- The exact pinned official SDK/CLI passes the deterministic local live verifier.
- Isolated Compose proves private/non-root/read-only/resource-bounded operation,
  readiness degradation and recovery.
- Authenticated browser tests prove Codex readiness/provenance and that no
  credential material reaches DOM, browser storage, logs or API responses.
- Phase 4 is complete only after the real ChatGPT-authenticated run succeeds;
  local protocol proof alone is not sufficient.
