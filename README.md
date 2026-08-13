# Agent Operating Environment

Personal, self-hosted AI World and control center in which World and Command are
two projections of one canonical domain and event stream.

The repository is under incremental construction. Phase 0 reuse/licensing audit
is complete; Phase 1 currently provides the first versioned domain contracts.
It is not yet a deployable product.

## Quick start

Requirements: Node.js `24.15.x` and npm `11.12.x`.

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
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
| `npm run clean` | Remove TypeScript project-reference outputs |

## Architecture

- [`@agent-world/domain`](packages/domain/README.md) owns versioned wire schemas
  and branded identifiers shared by every future service and UI.
- PostgreSQL will be the canonical source of truth. Runtime systems receive
  projections and return validated events.
- OpenClaw is the primary general runtime; Codex and other execution surfaces
  remain adapters.
- World and Command will consume the same read model and replay cursor.

Key evidence and decisions:

- [Phase 0 reuse matrix](docs/audits/phase-0/reuse-matrix.md)
- [Initial composition](docs/decisions/0003-initial-system-composition.md)
- [Canonical contract decision](docs/decisions/0004-canonical-domain-contracts.md)
- [Phase 1 delivery plan](tasks/phase-1-plan.md)

## Security baseline

- External data is parsed through strict schemas; unknown fields fail closed.
- Canonical IDs are runtime-prefixed and compile-time branded, preventing
  Agent/Account/Session substitution.
- World events require runtime or canonical-domain provenance. There is no
  simulation/decorative event source.
- Credentials do not belong in domain or event contracts.
- Secrets, local environment files and build outputs are ignored by Git.
