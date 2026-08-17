# Agent Operating Environment

Personal, self-hosted AI World and control center in which World and Command are
two projections of one canonical PostgreSQL domain and event stream.

The repository implementation spans the planned product phases: canonical Hub
identities, OpenClaw/Codex/API/local execution adapters, Mission orchestration,
Resource Broker routing, lazy context/RAG, Memory Center, schedules,
integrations, Observatory telemetry, Native Plus Chat Control/MCP boundaries and
a hardened one-VDS Docker Compose topology. The application remains fail-closed
when an external execution surface has not been owner-activated.

Current automated release evidence is tracked in
[`docs/audits/acceptance-2026-08-17.md`](docs/audits/acceptance-2026-08-17.md).
At the recorded head, all eight CI jobs pass and 22/24 product acceptance
criteria are PASS. The remaining two criteria require real owner/environment
proof: one personal Plus MCP/App terminal run and one approved operation against
a provisioned SSH host. A successful real ChatGPT-authenticated Codex Run is a
separate production-activation gate. No fixture substitutes for these live
proofs.

## Quick start

Requirements: Node.js `24.15.x` and npm `11.12.x`.

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The committed `.npmrc` disables dependency lifecycle scripts. The authoritative
lock file is used by CI with `npm ci --ignore-scripts`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Frozen installation from the authoritative lock file |
| `npm test` | Deterministic Vitest contract/unit suite |
| `npm run typecheck` | Strict TypeScript validation without emit |
| `npm run lint` | Biome formatting, lint and import checks |
| `npm run build` | TypeScript/Next production build |
| `npm run dev:web` | Start the Next.js owner application for development |
| `npm run test:e2e` | Five responsive Chromium projects plus visual/accessibility evidence |
| `npm run test:runtime` | Standalone auth/API/restart verification against disposable PostgreSQL |
| `npm run test:db` | Isolated PostgreSQL migrations and durable-store scenarios |
| `npm run test:orchestration` | LangGraph/Mission orchestration verification |
| `npm run test:openclaw-live` | Pinned real OpenClaw Gateway contract/transcript verifier |
| `npm run test:litellm-live` | Pinned LiteLLM gateway/projection verifier |
| `npm run test:codex-live` | Official Codex SDK/CLI deterministic verifier |
| `npm run test:compose` | Isolated HTTPS Compose, degradation and backup/restore verification |
| `npm run bootstrap:token --workspace @agent-world/native-chat-launcher -- <absolute-token-file>` | Generate the host-launcher bearer token and print only its SHA-256 verifier |
| `npm start --workspace @agent-world/native-chat-launcher` | Run the host-local Native Plus Chat `run_id` launcher |
| `npm run clean` | Remove TypeScript project-reference outputs |

Copy `.env.example` into an ignored local environment file and replace every
placeholder before a composed deployment. PostgreSQL stays private to the
Compose data network. Plaintext PostgreSQL is accepted only on loopback or with
the exact private-network acknowledgement. OpenClaw, Graphiti, Langfuse, Native
Chat and local-model origins are optional and fail closed when their required
configuration is absent.

## Production activation boundaries

### Codex

Set `AGENT_WORLD_CODEX_ACCOUNT_ID` to a canonical `CHATGPT_INTERACTIVE` Account
with CODEX surface. The worker separates process/database health from ChatGPT
authentication readiness and will not claim work while auth is unavailable.
Authenticate the pinned official CLI into its dedicated Compose volume without
copying credential files:

```sh
docker compose run --rm codex-worker codex login --device-auth
docker compose run --rm codex-worker codex login status
docker compose up -d --wait codex-worker
```

The repository verifier proves the official SDK/CLI contract, but production
activation still requires one successful real owner-authenticated Run with
terminal provenance.

### Native Plus Chat

Native Plus Chat uses an isolated OAuth/MCP resource plus a host-local browser
launcher. The launcher only opens the configured AI World GPT/App, submits the
canonical `run_id`, and records browser submission. It never reads Chat output
from the DOM. Results enter AI World only through authenticated Control/MCP
calls.

The laptop no longer connects directly to PostgreSQL. It calls the scoped
`/api/native-chat-launcher` HTTPS endpoint with a dedicated random token whose
SHA-256 verifier is stored server-side. PostgreSQL remains private. See
[`docs/native-chat-mcp.md`](docs/native-chat-mcp.md) for bootstrap, profile and
live-proof instructions.

### RAG and local models

Project-shared RAG ingestion becomes available only when
`AGENT_WORLD_RAG_EMBEDDING_MODEL_ROUTE_ID` points to an eligible canonical
embedding ModelRoute. LiteLLM owns model transport; AI World owns route
semantics, durable Context/RAG state and product presentation. Local model
origins require an explicit narrow allowlist.

### Integrations

MCP, n8n, GitHub and SSH/VDS integrations are configured through the owner Hub.
Credentials remain write-only/encrypted, network hosts are allowlisted, SSH
operations are predefined and host-key pinned, and mutations use explicit
durable approval. No generic raw shell or PTY surface is exposed.

## Architecture

- [`@agent-world/domain`](packages/domain/README.md) owns strict versioned wire
  schemas, branded identifiers and execution/memory/mission contracts.
- [`@agent-world/postgres-store`](packages/postgres-store/README.md) owns the
  checksum-locked canonical PostgreSQL schema, durable stores, event history,
  resource evidence and replay boundaries.
- [`@agent-world/read-model`](packages/read-model/README.md) projects canonical
  World, Command, Hub, Operations and integration state without secrets.
- [`@agent-world/openclaw-adapter`](packages/openclaw-adapter/README.md) maps the
  official Gateway into binding-first reads/writes and canonical Run evidence.
- The Codex adapter/worker uses the official SDK/CLI and a separate durable
  worker/auth boundary.
- LiteLLM is the single model gateway; API_MODEL and LOCAL_MODEL are adapters
  behind canonical ModelRoutes and Resource Broker decisions.
- LangGraph provides durable Mission routing/checkpoints/review/retry/handoffs;
  PostgreSQL remains product authority.
- pgvector supplies canonical Context/RAG retrieval. Graphiti/FalkorDB is an
  optional rebuildable memory projection, never a second source of truth.
- [`@agent-world/web`](apps/web) is the single owner-facing application. World,
  Command, Hub, Memory Center and Observatory use canonical server read models;
  browsers never receive runtime gateway credentials.
- OpenClaw Office contributes presentation primitives only; AI World owns the
  renderer state and domain mapping.
- Langfuse is an optional scrubbed telemetry projection behind the native
  Observatory, not a product dashboard dependency.

## Canonical invariants

- `AgentTemplate`, `Agent`, `Account`, runtime Session and Conversation are
  distinct concepts and cannot substitute for one another.
- `Mission` owns the goal; Tasks own intent; Runs own concrete execution.
- PostgreSQL is the canonical source of truth. External runtimes and telemetry
  systems are projections/adapters.
- World animation and handoff cues are deterministic event projections and do
  not consume LLM tokens.
- Every execution backend sits behind typed, versioned boundaries and durable
  evidence.
- Resource Broker chooses eligible execution resources from fresh evidence;
  transports never silently choose themselves.
- Context is lazy and bounded. Full history is not broadcast to every Agent.
- Native Chat browser automation may submit only `run_id`; supported Control/MCP
  APIs are the only completion channel.
- Secrets never belong in product read models, event payloads or browser state.

## Deployment and evidence

The hardened topology, backup/restore procedure and rollback gates are in
[`ops/DEPLOYMENT.md`](ops/DEPLOYMENT.md). The current product acceptance matrix
and live gates are in
[`docs/audits/acceptance-2026-08-17.md`](docs/audits/acceptance-2026-08-17.md).
The implementation plan is [`tasks/plan.md`](tasks/plan.md).

Key architecture decisions and reuse evidence remain under
[`docs/decisions`](docs/decisions) and [`docs/audits/phase-0`](docs/audits/phase-0).

For local contract-fixture inspection only:

```powershell
$env:AGENT_WORLD_DATA_SOURCE='contract-fixture'
npm run dev:web
```

The production provider ignores that fixture switch. Production readiness is
not claimed from fixtures: live Account/host gates remain explicit until they
are exercised against the owner's real environment.
