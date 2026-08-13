# Single-user deployment

The core deployment is one Next.js application, one PostgreSQL source of truth,
one private official Codex SDK worker and Caddy as the only published edge.
OpenClaw remains an adapter target and is not duplicated in this Compose project.

## Host prerequisites

- A current Docker Engine with Compose v2, at least 4 CPU cores, 4 GiB RAM and
  persistent disk space outside ephemeral container storage.
- A DNS A/AAAA record pointing the chosen hostname at the host. Allow inbound
  TCP 80 and 443 so Caddy can obtain and renew a public certificate.
- A separately managed, supported OpenClaw Gateway when runtime execution is
  enabled. Do not automate consumer ChatGPT pages.

## First start

1. Copy `.env.example` to the ignored `.env` file and restrict it to the host
   owner (`chmod 600 .env` on Linux).
2. Replace the PostgreSQL password and CSRF secret with independent URL-safe
   values generated from at least 32 random bytes. Set a valid offline-generated
   `scrypt-v1` owner password hash; keep the single quotes because `$` is data.
3. Set `AGENT_WORLD_SITE_ADDRESS` to the public HTTPS origin and
   `AGENT_WORLD_CODEX_PROJECT_ROOT` to the exact host Git root the worker may
   modify. Configure exactly one OpenClaw credential kind only when the Gateway
   is ready.
4. Validate and start:

   ```sh
   docker compose config --quiet
   docker compose up -d --build --wait --wait-timeout 120
   curl --fail --silent https://your-host.example/api/health/ready
   ```

PostgreSQL and the web port are never published. Only Caddy binds host ports.
`/api/health/live` proves the web process can serve HTTP; `/api/health/ready`
also probes PostgreSQL through the published production runtime. Neither route
contains secrets or detailed topology.

The Codex worker is non-root, read-only except for the selected repository,
temporary space and its dedicated Codex state volume. It does not claim work
until the official CLI reports ChatGPT authentication. Authenticate without
reading or copying Codex-owned credential files:

```sh
docker compose run --rm codex-worker codex login --device-auth
docker compose run --rm codex-worker codex login status
docker compose up -d --wait codex-worker
```

An unavailable login degrades only Codex execution readiness; container and
database availability remain separately observable at the private worker health
endpoint.

For an isolated destructive acceptance run, use a disposable Docker host or
run `AGENT_WORLD_COMPOSE_TEST_ACK=isolated npm run test:compose`. The verifier
uses a unique Compose project and random ports, proves HTTPS, database
degradation, backup/restore and container isolation, then removes its own
containers and volumes.

## Backup and restore

Create a PostgreSQL custom-format backup while the stack is healthy:

```sh
ops/backup.sh
```

The script creates an atomic mode-0600 file under the ignored `backups/`
directory. Copy completed backups to encrypted off-host storage and regularly
test them on an isolated host. A backup left on the same VDS is not disaster
recovery.

Restore is intentionally destructive and only accepts a file under the
configured backup directory:

```sh
AGENT_WORLD_RESTORE_ACK=replace-database ops/restore.sh backups/agent-world-YYYYMMDDTHHMMSSZ-XXXXXX.dump
curl --fail --silent https://your-host.example/api/health/ready
```

Restore validates the archive, stops both web and Codex worker writers, uses one
PostgreSQL transaction, restarts both and waits for readiness. Caddy may return
503 while the writers are stopped; that is preferable to serving mixed database
state.

## Upgrade and rollback

Before every upgrade, make and copy a verified backup, retain the current image
tag, then build a new immutable tag:

```sh
AGENT_WORLD_IMAGE_TAG=2026-08-13.1 docker compose build web
AGENT_WORLD_IMAGE_TAG=2026-08-13.1 docker compose up -d --no-deps --wait web
```

Advance only when readiness, login, World/Command parity and one approval-gated
execution are green. Roll back immediately on data-integrity errors, new auth
failures, readiness instability, an error-rate doubling or p95 latency growing
over 50%. Re-select the retained image with `--no-build`; if the new migration
is incompatible, restore the matching pre-upgrade backup before starting the
old image. Never try to partially reverse a migration in the live database.

## Routine checks

- Watch structured JSON logs from `web` and `caddy`; bounded runtime telemetry
  never includes credentials or raw payloads.
- Alert on readiness failures, restart loops, disk pressure, PostgreSQL backup
  age, and sustained resource use near the Compose limits.
- Run `npm audit --audit-level=high`, signature verification and the complete CI
  gate against each exact release head.
- Patch the host and rebuild digest pins deliberately; do not use floating
  `latest` images or unattended destructive dependency fixes.
