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
- Strict tool arguments contain no Account field. The trusted JWT subject is the
  Account and the PostgreSQL store verifies it against the selected dispatch.
- Ordered, idempotent event append; `commit_result` stores the complete validated
  structured result before returning success.

The server does not read Chat output from the DOM and does not treat a visible
Chat response as completion evidence.

## Fail-closed configuration

All values are required before the routes become discoverable:

```dotenv
AGENT_WORLD_MCP_ENABLED=true
AGENT_WORLD_MCP_RESOURCE=https://agent-world.example.com/api/mcp
AGENT_WORLD_MCP_OAUTH_ISSUER=https://agent-world.example.com/oauth
```

The issuer must publish OAuth/OIDC metadata and an ES256 P-256 public JWKS at
`<issuer>/jwks`. Tokens must use the exact MCP resource as their only audience,
the canonical `account_<uuid>` as subject, and scope `ai_world.run.write`.

## Remaining activation gates

- Ship or connect the authorization server with Authorization Code + PKCE,
  resource indicators and ChatGPT-compatible client registration.
- Add bounded lazy Run/task/context/memory/skill pull tools.
- Create dispatches through the Resource Broker and on-demand launcher.
- Complete a real personal Plus Chat run through `commit_result`; until then the
  product must continue to label CHAT unavailable/non-selectable.

Protocol references:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
