# Runtime and control-plane audit

Audit date: 2026-08-13. PostgreSQL owns canonical Agents, Accounts, Routes,
Projects and policy. Runtime and control-center data are projections.

## Runtime decision

OpenClaw is the sole general agent runtime in the first composition. Integrate
through its public gateway packages and plugin SDK. Do not import `src/**` or
the private agent-core package. Side-effecting requests must preserve the
gateway idempotency-key contract, scopes, sequence and state-version fields.

Codex is a specialist execution route, not a second canonical agent framework.
Use an official Codex SDK behind `ExecutionAdapter`. Direct app-server WebSocket
transport is feature-gated because current official documentation labels the
command/transport experimental and unsupported for production.

Current official OpenAI documentation confirms that the SDK is intended for
integrating coding-focused Codex threads into applications and that local Codex
supports ChatGPT-subscription or API-key authentication. It separately warns
that direct app-server WebSocket transport is experimental/unsupported. Recheck
these current, non-pinned pages at Phase 4:

- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Codex authentication](https://developers.openai.com/codex/auth/)

## Candidate findings

| Candidate | Reusable surface | Rejected or replaced surface | Classification |
| --- | --- | --- | --- |
| `openclaw/openclaw` | Public `@openclaw/gateway-client`, `@openclaw/gateway-protocol`, `openclaw/plugin-sdk/*`, scoped/idempotent gateway protocol | Internal `src/**`, private agent core, config as canonical state | Direct runtime service plus adapter |
| `openclaw-control-center` | Operator presentation, SSE/event-stream and audit UX patterns | Local JSON stores, direct runtime config ownership, deterministic synthetic role messages | Port selected UI only |
| `openclaw-nerve` | Fleet/session navigation, workspace/file panels, command palette, responsive interaction patterns | Direct local-filesystem authority, CLI mutation, browser-persisted gateway token | Port selected UI after security rewrite |
| `openagents` | Connector/event normalization patterns | External workspace default, tokens in URLs, Codex adapter that bypasses approvals/sandbox | Reference only |
| `AionUi` | Assistant/persona-to-runtime separation, runtime selector, safe skill-file traversal | Electron/Rust persistence and provider-owned model arrays as product domain | Port selected components/patterns |
| `openai/codex` | Official SDK, generated protocol schemas, threads/turns/approvals/events | Direct experimental WebSocket as production dependency | Official specialist adapter |

## Key source evidence

- OpenClaw explicitly defines plugin SDK barrels as its public boundary and says
  plugins do not import internals in
  [`agent-runtime-architecture.md`](https://github.com/openclaw/openclaw/blob/b05d2308e7a58be5e2b4a8b5d2823e0a217b3425/docs/agent-runtime-architecture.md#L6-L24).
- Its gateway protocol carries sequence/state versions and requires idempotency
  for side effects in
  [`protocol.md`](https://github.com/openclaw/openclaw/blob/b05d2308e7a58be5e2b4a8b5d2823e0a217b3425/docs/gateway/protocol.md#L36-L82).
- Control Center stores projects/tasks/budgets in local JSON according to
  [`ARCHITECTURE.md`](https://github.com/TianyiDataScience/openclaw-control-center/blob/5d1e3245d9540b676aca7069c3f900bb36d8d44f/docs/ARCHITECTURE.md#L30-L45),
  while [`agent-dispatch.ts`](https://github.com/TianyiDataScience/openclaw-control-center/blob/5d1e3245d9540b676aca7069c3f900bb36d8d44f/src/runtime/agent-dispatch.ts#L11-L31)
  manufactures role narration. Neither can represent real system truth.
- Nerve's comment promises session storage but its implementation writes the
  gateway token to local storage in
  [`GatewayContext.tsx`](https://github.com/daggerhashimoto/openclaw-nerve/blob/312e27333e14f841b95bf4f2b205a856b4a4c370/src/contexts/GatewayContext.tsx#L37-L45).
- OpenAgents defaults to a hosted workspace and places a token in a returned URL
  in [`workspace-client.js`](https://github.com/openagents-org/openagents/blob/4e94efe4391166c5ce9a38c5eb9d7cda2aad3306/packages/agent-connector/src/workspace-client.js#L1-L72).
  Its Codex adapter uses an explicit sandbox/approval bypass in
  [`codex.js`](https://github.com/openagents-org/openagents/blob/4e94efe4391166c5ce9a38c5eb9d7cda2aad3306/packages/agent-connector/src/adapters/codex.js#L288-L313).
- AionUi models an Assistant with a separate agent backend in
  [`assistantTypes.ts`](https://github.com/iOfficeAI/AionUi/blob/0864694ef3bd8a280a1885a132bf65b8a68bf014/packages/desktop/src/common/types/agent/assistantTypes.ts#L10-L50)
  and checks resolved paths against the skill root in
  [`skillFiles.ts`](https://github.com/iOfficeAI/AionUi/blob/0864694ef3bd8a280a1885a132bf65b8a68bf014/packages/desktop/src/process/services/skills/skillFiles.ts#L10-L40).
- Codex's pinned source labels WebSocket experimental/unsupported in
  [`app-server/README.md`](https://github.com/openai/codex/blob/902bd9e06b3ecb32cbf7f8e64cd23b956be3e7fe/codex-rs/app-server/README.md#L22-L38),
  while the official TypeScript SDK wraps the CLI and streams JSONL in
  [`sdk/typescript/README.md`](https://github.com/openai/codex/blob/902bd9e06b3ecb32cbf7f8e64cd23b956be3e7fe/sdk/typescript/README.md#L1-L40).

## Required adapter invariants

- Runtime session IDs are external references, never Agent primary keys.
- Runtime config is reconciled from PostgreSQL and drift is observable.
- Incoming events are validated, assigned a canonical event ID, persisted, then
  projected to World and Command.
- Reconnect resumes from a cursor/sequence and is idempotent.
- Credentials remain server-side or in an OS/secret store; no browser storage.
- Approval and sandbox policy can only become stricter at an adapter boundary.
