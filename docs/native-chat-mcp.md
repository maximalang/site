# Native Plus Chat MCP resource server

AI World exposes a fail-closed Streamable HTTP MCP resource at `/api/mcp`.
ChatGPT is an execution surface; PostgreSQL remains the owner of Run state,
structured results and canonical Control events.

## Implemented boundary

- RFC 9728 protected-resource metadata:
  `/.well-known/oauth-protected-resource/api/mcp`.
- ES256 access-token validation through OAuth discovery and public JWKS.
- Exact `iss`, single exact `aud`, canonical Account `sub`, expiry/issued-at and
  `ai_world.run.write` scope validation.
- Origin allowlist for ChatGPT plus exact same-origin requests.
- `begin_run`, `emit_run_event`, `commit_result` and `fail_run` tools.
- `get_run_resources` performs bounded lazy pulls after `begin_run`. TASK,
  project state, assigned skills, canonical Action history, Memory, RAG chunks
  and Artifacts include SHA-256 and PostgreSQL provenance. Every data-bearing
  lookup is constrained to the Run's canonical Project.
- Every pull records requested resource classes, a query hash, item/token
  limits, actual counts and response hash in PostgreSQL. Raw search text is not
  retained in the receipt.
- Strict tool arguments contain no Account field. The trusted JWT subject is the
  Account and the PostgreSQL store verifies it against the selected dispatch.
- Canonical Native Chat Runs store `route_id`, `account_id` and `CHAT` mode
  directly. They cannot contain a fabricated runtime binding or conversation
  session; OpenClaw/Codex Runs retain their required binding/session shape.
- Resource Broker observations and decisions are append-only PostgreSQL
  evidence. Decisions record policy version, normalized candidate inputs,
  scores, exclusions, selected route/account and a content hash. Missing or
  expired observations never silently become availability.
- Approval resolves Simple/Advanced execution preferences, persists the broker
  decision and creates the approved Run plus `QUEUED` Native Chat dispatch in
  the same transaction. Runtime routes must have an active session bound to the
  exact selected route; Native Chat must not have one.
- The launcher queue uses PostgreSQL `FOR UPDATE SKIP LOCKED` leases. Account IDs
  map to opaque browser-profile aliases; filesystem paths, cookies and login
  identities never enter canonical dispatches. Successful submission records a
  versioned SHA-256 receipt, while duplicate or expired claims fail closed.
- Ordered, idempotent event append; `commit_result` stores the complete validated
  structured result before returning success.
- Every dispatch persists a 30-minute attach deadline and, after `begin_run`, a
  four-hour completion deadline. A restart-safe supervisor reconciles missing
  begin/commit and terminal launcher failures into one idempotent `FAIL` Control
  event, failed Run and failed World projection. Calls arriving at or after the
  deadline fail closed; exact replays remain deterministic.
- The same `commit_result` transaction materializes an `AGENT_RESULT` shared
  context item, creates provenance-linked pending Memory Inbox proposals for
  declared memory candidates, appends their replayable memory events, completes
  the Run and updates the World projection. Task state and Action Graph remain
  derived from the immutable Task intent plus canonical Run/Control events.
- Isolated PostgreSQL-backed OAuth provider under `/oauth` with public-client
  DCR, Authorization Code, mandatory PKCE S256, exact resource indicators,
  ES256 access tokens, revocation and rotating refresh tokens.
- The owner selects one eligible canonical CHAT Account during login. The JWT
  subject is that Account ID; OAuth sessions never create or identify Agents.
- Renewable sessions remain available when a cached ChatGPT authorization
  request omits `offline_access`, matching the failure mode proven and repaired
  in the owner's Timeweb MCP bridge. The adopted pattern is public-client DCR +
  PKCE, persistent PostgreSQL grants, rotating refresh tokens, refresh-family
  revocation on replay, exact audience/resource binding and auditable refresh
  outcomes; no Recruiter Radar domain or storage code is shared.
- Canonical RAG documents preserve multiple source aliases and deduplicate by
  Project/content hash. Chunks support optional 1536-dimensional embeddings,
  a partial cosine HNSW index and bounded project-filtered retrieval with
  iterative scan enabled for filtered approximate search.

The server does not read Chat output from the DOM and does not treat a visible
Chat response as completion evidence.

## Custom GPT Actions fallback

During development, a Custom GPT can use the equivalent OpenAPI 3.1 contract
at `/api/chat-actions/openapi.json`. It exposes five explicit operations over
the same canonical Control implementation:

- `beginRun`;
- `getRunResources`;
- `emitRunEvent`;
- `commitResult`;
- `failRun`.

Configure the Action with OAuth Authorization Code using `<issuer>/auth`,
`<issuer>/token` and scope `ai_world.run.write`. The access token has the same
exact `/api/mcp` resource audience as the MCP connection. Account identity is
derived only from the OAuth subject and is intentionally absent from every
request schema. This adapter does not own state and cannot bypass event order,
idempotency, project boundaries or the terminal commit requirement.

## Host-local browser launcher

The on-demand launcher runs on the owner's laptop, outside Docker and Timeweb,
because the authenticated ChatGPT browser profiles remain local. Build and run
it with:

```powershell
npm.cmd run build --workspace @agent-world/native-chat-launcher
npm.cmd start --workspace @agent-world/native-chat-launcher
```

Configure the launcher with the variables documented in `.env.example`. On the
first launch, Chrome opens a dedicated directory below
`AGENT_WORLD_NATIVE_CHAT_PROFILE_ROOT`; the owner signs in manually. Use one
opaque profile alias and directory per ChatGPT Account. AI World never asks for
or exports passwords, two-factor codes, cookies or browser storage.

The owner can configure each canonical ChatGPT Account in Hub → Native Plus
Chat. Simple mode requires only the Account and AI World App URL and assigns an
opaque profile alias automatically; Advanced mode permits changing that alias
or disabling its launcher mapping. The owner-only API stores the mapping in
PostgreSQL. Browser filesystem paths remain host-local and never enter the API
or canonical database.

`AGENT_WORLD_NATIVE_CHAT_LAUNCH_URL` must point to the AI World GPT/App connected
to this MCP resource. Its instructions must call `begin_run(run_id)`, pull only
needed context with `get_run_resources`, emit structured progress events, and
finish with `commit_result` or `fail_run`. The launcher opens that surface,
fills only the exact `run_id`, clicks Send and records a versioned submission
receipt after the new Chat URL is observed. It neither inspects response nodes
nor waits for the final response. The page remains open for a bounded retention
window so the native Chat runtime can complete independently through MCP.

## Fail-closed configuration

All values are required before the routes become discoverable:

```dotenv
AGENT_WORLD_MCP_ENABLED=true
AGENT_WORLD_MCP_RESOURCE=https://agent-world.example.com/api/mcp
AGENT_WORLD_MCP_OAUTH_ISSUER=https://agent-world.example.com/oauth
AGENT_WORLD_MCP_AUTH_PROVIDER=local_oidc
AGENT_WORLD_MCP_OAUTH_JWKS_FILE=/secure/agent-world-oauth-jwks.json
AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE=/secure/agent-world-oauth-cookie-keys.json
```

The issuer must publish OAuth/OIDC metadata and an ES256 P-256 public JWKS at
`<issuer>/jwks`. Tokens must use the exact MCP resource as their only audience,
the canonical `account_<uuid>` as subject, and scope `ai_world.run.write`.

The optional Compose service is enabled with `--profile native-chat`. Private
signing and cookie-key files are mounted read-only and are never available to
the web resource server.

## Remaining activation gates

- Deploy the implemented authorization server behind the production HTTPS
  endpoint and verify its public discovery/JWKS/DCR and Actions OpenAPI
  contracts.
- Connect ingestion/chunking and an embedding adapter to the canonical RAG
  write store. Every written chunk is already materialized as provenance-linked
  shared context and ranked against the Task during ContextPack compilation,
  but automated source ingestion and embedding generation are not yet activated.
- Run the host-local launcher against an owner-authenticated dedicated profile
  and record a real browser-submission receipt. The queue, driver and receipt
  path are implemented but still require this live E2E.
- Complete a real personal Plus Chat run through `commit_result`; until then the
  product must continue to label CHAT unavailable/non-selectable.

Protocol references:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
