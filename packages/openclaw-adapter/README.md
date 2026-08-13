# `@agent-world/openclaw-adapter`

Server-side OpenClaw Gateway integration for the Agent Operating Environment.
It combines physically separate read-only lifecycle projection and narrowly
scoped chat/Task execution without allowing OpenClaw Agent or Session identifiers to
become product identity.

Its public surfaces expose no raw Gateway request method. The read adapter has
no side-effecting operation; the write adapter exposes only canonical
conversation delivery, approved Task dispatch and terminal Run observation.

## Write boundary

`OpenClawWriteAdapter` uses a separate official Gateway client and requests the
`operator` role with exactly `operator.write`. A handshake with missing,
additional or incompatible authority is rejected. The client exposes only
`chat.send` internally and every projected request is checked by the public,
pinned protocol validators before transport. Approved Tasks use the distinct
`agent` RPC and terminal observation uses `agent.wait`; the adapter exposes no
generic request escape hatch.

The domain idempotency key is forwarded unchanged, `suppressCommandInterpretation`
is always true, and only the persistence-verified external Agent/session pair
can be projected into the call. The immediate response is treated only as an
acceptance receipt; it never becomes Agent-authored conversation content.

Write telemetry is bounded to state, authority, outcome and duration. It omits
message text, session keys, external Agent IDs, provider errors and credentials.

## Public boundary

The implementation uses only these supported package entry points:

- `@openclaw/gateway-client` for the official Node WebSocket state machine;
- `@openclaw/gateway-protocol` and its public `client-info` and `version`
  exports for protocol types and constants.

Both packages are pinned exactly to `2026.8.1-beta.1`. No `openclaw/src/**`,
bundled `dist/**` implementation path or private agent core is imported.

The adapter requests the `operator` role with exactly one scope:
`operator.read`. It exposes only four read RPCs internally:

| RPC | Purpose |
| --- | --- |
| `agents.list` | Discover configured upstream Agent references |
| `sessions.list` | Reload bounded runtime/session state |
| `sessions.subscribe` | Receive invalidation signals |
| `system-presence` | Read ephemeral Gateway/device presence |

An accepted handshake with any missing or additional authority is rejected and
the Gateway client is stopped. Plain `ws://` is accepted only for loopback;
remote endpoints require `wss://`. Credentials, user info, query strings and
fragments are forbidden in endpoint URLs.

## Projection semantics

- A preconfigured `RuntimeBinding` is required before an upstream Agent can
  appear as a canonical Agent.
- Canonical display names always win over upstream names.
- Session keys and session IDs remain opaque external references.
- Active runs map to `RUNNING`; a latest failed or timed-out session maps to
  `FAILED`; configured Agents without an active run map to `IDLE`; missing
  upstream bindings map to `OFFLINE`.
- Presence is ephemeral Gateway/device information, not proof that an Agent is
  alive. Host, IP, user and free-form display text are discarded.
- Additive upstream fields are allowlist-projected away. Required malformed,
  unsafe or oversized fields fail the whole authoritative reload.

Events are invalidations, not canonical facts. On an accepted handshake,
supported event or sequence gap, the adapter reloads agents, sessions and
presence from authoritative read RPCs. Duplicate and stale sequence numbers are
ignored. Sequence state resets on reconnect and the public source cursor carries
the connection epoch, per-connection sequence and Gateway state version.

Disconnect publishes an explicit offline projection. A response that completes
after disconnect or a newer handshake is discarded as stale.

## Secret handling

`credentialProvider` is a server-side callback and must read from an OS secret
store, injected secret file or equivalent runtime facility. The adapter accepts
only a Gateway token or paired device token, never a password. It does not put
credentials into URLs, snapshots or telemetry and drops its client reference on
stop. Browsers must never construct this adapter or receive its credentials.

## Structured telemetry

Telemetry is deliberately low-cardinality and contains no upstream payload,
error message, URL, session key or credential:

| Operator question | Events |
| --- | --- |
| Did the adapter connect with exact read authority? | `adapter_state_changed`, `openclaw_sync_completed` with `REJECTED_AUTHORITY` |
| Is the projection current, and did an authoritative reload succeed? | `openclaw_sync_completed` with trigger, bounded outcome and duration |
| Was transport order lost or an event ignored? | `openclaw_sequence_gap`, `openclaw_event_ignored` |
| Did transport fail before or after hello? | `openclaw_connection_error` with bounded phase and code |

The host supplies a correlation ID and telemetry sink. The sink must preserve
the same no-payload/no-secret contract.

## Verification and maturity

Contract tests cover normalization, malformed responses, exact authority,
endpoint and credential policy, duplicate/out-of-order events, reconnect,
late-response suppression, offline projection and telemetry redaction. The
workspace also runs typecheck, lint, build, package-content, dependency audit,
registry signature and attestation gates.

The official client, protocol and CLI packages remain prerelease packages; no
equivalent `2026.8.1` stable artifacts exist in the registry as of the recorded
Phase 1 verification. The exact `2026.8.1-beta.1` artifacts are lockfile-pinned.
`npm run test:openclaw-live` now starts that real CLI against disposable
loopback state and a deterministic model endpoint, proves separate read/write
authority, executes `agent` + `agent.wait`, and reads the marker back through
canonical transcript history. Running it requires
`AGENT_WORLD_OPENCLAW_LIVE_TEST_ACK=isolated`.

Relevant official contracts:

- <https://docs.openclaw.ai/gateway/clients>
- <https://docs.openclaw.ai/gateway/protocol>
- <https://docs.openclaw.ai/concepts/presence>
