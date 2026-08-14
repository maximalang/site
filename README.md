# Agent Operating Environment

Personal, self-hosted AI World and control center in which World and Command are
two projections of one canonical domain and event stream.

The repository is under incremental construction. Phase 0 reuse/licensing audit
is complete; Phase 1 currently provides versioned domain contracts, separated
read/write OpenClaw adapters, canonical PostgreSQL conversations and inbound
runtime messages, secure owner sessions, restart-safe World replay, and one
browser application with World and Command projections over the same strict
read model. Owner chat and approval-gated task assignment are available through
authenticated APIs and accessible drawers. Explicit approval now creates one
durable canonical Run, dispatches through the official OpenClaw `agent` RPC,
observes `agent.wait`, and recovers pending/running work after restart. Phase 2
also has canonical Hub identities, owner-only control commands, inherited
execution preferences and the Lobby UI. Later domain phases remain open, but
the shell now has a verified single-user core deployment, HTTPS edge,
transactional backup/restore path and a private official Codex SDK worker with
durable PostgreSQL leases and normalized execution evidence.

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

The committed `.npmrc` disables dependency lifecycle scripts. The current lock
file does not require install-time scripts for the supported toolchain.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Frozen installation from the authoritative lock file |
| `npm test` | Run deterministic Vitest contract tests once |
| `npm run typecheck` | Check source and negative type tests without emitting |
| `npm run lint` | Run Biome formatting, lint and import checks |
| `npm run build` | Build TypeScript project references in dependency order |
| `npm run dev:web` | Build the shared read model and start the Next.js app |
| `npm run test:e2e` | Run five responsive Chromium projects plus standalone production smoke |
| `npm run test:runtime` | Build and verify standalone auth/API/restart against disposable PostgreSQL |
| `npm run test:openclaw-live` | Verify the pinned real OpenClaw Gateway and transcript round trip (explicit isolated ACK required) |
| `npm run test:codex-live` | Launch the pinned official Codex SDK/CLI against an isolated deterministic Responses endpoint (explicit ACK required) |
| `npm run test:compose` | Destructively verify an isolated HTTPS core stack, degradation and backup/restore (explicit ACK required) |
| `npm start --workspace @agent-world/native-chat-launcher` | Run the host-local Native Plus Chat `run_id` launcher |
| `npm run clean` | Remove TypeScript project-reference outputs |

Copy `.env.example` into an ignored local environment file and replace every
placeholder before starting the composed server. PostgreSQL TLS policy is
explicit; plaintext is accepted only on loopback or with the exact private
network acknowledgement. OpenClaw is optional at startup and remains visibly
unavailable until configured and authority-verified.

The Codex worker is safe to start before authentication: its health keeps
process/database availability separate from `CHATGPT` authentication readiness
and it will not claim work while auth is unavailable. Authenticate the pinned
official CLI into its dedicated Compose volume without copying credential files:

Before starting Compose, set `AGENT_WORLD_CODEX_ACCOUNT_ID` to the canonical
`CHATGPT_INTERACTIVE` Account created through the owner-only Hub command API.
Create its `CODEX_ROUTE_CREATE` route from an enabled CODEX ModelRoute; the
server fixes workspace-write, approval-on-request, network-off and a bounded
timeout. The worker then records fresh authentication readiness for that exact
Account in PostgreSQL. Stale or missing readiness fails routing closed.

```sh
docker compose run --rm codex-worker codex login --device-auth
docker compose run --rm codex-worker codex login status
docker compose up -d --wait codex-worker
```

The hardened Compose topology, backup/restore procedure and rollback gates are
documented in [`ops/DEPLOYMENT.md`](ops/DEPLOYMENT.md).

For local contract-fixture inspection only:

```powershell
$env:AGENT_WORLD_DATA_SOURCE='contract-fixture'
npm run dev:web
```

The provider ignores this fixture switch in production. Install the pinned test
browser once with `npm exec --workspace @agent-world/web -- playwright install chromium`.

Native Plus Chat uses a separate host-local Chrome launcher and dedicated
authenticated profiles; it is intentionally not a Compose service. See
[`docs/native-chat-mcp.md`](docs/native-chat-mcp.md) for its fail-closed setup
and live activation gate.

## Architecture

- [`@agent-world/domain`](packages/domain/README.md) owns versioned wire schemas
  and branded identifiers shared by every future service and UI.
- [`@agent-world/openclaw-adapter`](packages/openclaw-adapter/README.md) uses the
  official Gateway client to produce a least-privilege, binding-first runtime
  projection and execute only approval-backed canonical Runs.
- [`@agent-world/read-model`](packages/read-model/README.md) replays canonical
  events into one bounded, versioned World/Command read boundary and defines
  the safe canonical Hub projection.
- [`@agent-world/postgres-store`](packages/postgres-store/README.md) owns the
  checksum-locked canonical PostgreSQL schema and durable store adapters.
- [`@agent-world/web`](apps/web) exposes owner-authenticated World,
  conversation and approval-gated task-assignment APIs and derives both the
  primary Canvas World and the Command agent table from one validated response.
  The browser has no direct runtime connection or gateway credential.
- PostgreSQL will be the canonical source of truth. Runtime systems receive
  projections and return validated events.
- OpenClaw is the primary general runtime; Codex and other execution surfaces
  remain adapters.
- World and Command consume the same read model and replay cursor.

Key evidence and decisions:

- [Phase 0 reuse matrix](docs/audits/phase-0/reuse-matrix.md)
- [Initial composition](docs/decisions/0003-initial-system-composition.md)
- [Canonical contract decision](docs/decisions/0004-canonical-domain-contracts.md)
- [OpenClaw read-adapter decision](docs/decisions/0005-openclaw-read-adapter-boundary.md)
- [World/Command read-surface decision](docs/decisions/0006-shared-world-command-read-surface.md)
- [Canonical PostgreSQL decision](docs/decisions/0007-canonical-postgresql-boundary.md)
- [Single-owner session decision](docs/decisions/0008-single-owner-session-boundary.md)
- [Node runtime composition decision](docs/decisions/0009-node-runtime-composition.md)
- [Approval-gated task assignment decision](docs/decisions/0010-approval-gated-task-assignment.md)
- [Canonical Hub identity decision](docs/decisions/0011-canonical-hub-identities.md)
- [Safe Hub read-model decision](docs/decisions/0012-safe-hub-read-model.md)
- [Phase 1 delivery plan](tasks/phase-1-plan.md)
- [Phase 2 canonical Hub plan](tasks/phase-2-plan.md)

## Security baseline

- Canonical domain input is strict. The upstream adapter allowlist-projects
  additive fields away and fails closed on malformed required fields.
- Canonical IDs are runtime-prefixed and compile-time branded, preventing
  Agent/Account/Session substitution.
- World events require runtime or canonical-domain provenance. There is no
  simulation/decorative event source.
- Credentials do not belong in domain or event contracts.
- OpenClaw credentials stay server-side; endpoint URLs cannot carry secrets and
  remote plaintext WebSockets are rejected.
- Secrets, local environment files and build outputs are ignored by Git.
