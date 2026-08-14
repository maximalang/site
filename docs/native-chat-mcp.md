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
  project state, assigned skills and canonical Action history include SHA-256
  and PostgreSQL provenance; unavailable Memory/RAG/Artifact stores are stated
  explicitly rather than fabricated.
- Every pull records requested resource classes, a query hash, item/token
  limits, actual counts and response hash in PostgreSQL. Raw search text is not
  retained in the receipt.
- Strict tool arguments contain no Account field. The trusted JWT subject is the
  Account and the PostgreSQL store verifies it against the selected dispatch.
- Canonical Native Chat Runs store `route_id`, `account_id` and `CHAT` mode
  directly. They cannot contain a fabricated runtime binding or conversation
  session; OpenClaw/Codex Runs retain their required binding/session shape.
- Ordered, idempotent event append; `commit_result` stores the complete validated
  structured result before returning success.
- Isolated PostgreSQL-backed OAuth provider under `/oauth` with public-client
  DCR, Authorization Code, mandatory PKCE S256, exact resource indicators,
  ES256 access tokens, revocation and rotating refresh tokens.
- The owner selects one eligible canonical CHAT Account during login. The JWT
  subject is that Account ID; OAuth sessions never create or identify Agents.
- Renewable sessions remain available when a cached ChatGPT authorization
  request omits `offline_access`, matching the failure mode proven and repaired
  in the owner's Timeweb MCP bridge.

The server does not read Chat output from the DOM and does not treat a visible
Chat response as completion evidence.

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
  endpoint and verify its public discovery/JWKS/DCR contract.
- Implement the canonical Memory/RAG/Artifact stores so those currently
  unavailable pull classes can return provenance-aware content.
- Create these transport-valid Runs and dispatches through the Resource Broker
  and on-demand launcher (the schema/store boundary is ready; selection is not).
- Complete a real personal Plus Chat run through `commit_result`; until then the
  product must continue to label CHAT unavailable/non-selectable.

Protocol references:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
