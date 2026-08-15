# Integration registry and health probes

The owner-only Hub stores MCP, n8n, GitHub and SSH endpoint metadata in
PostgreSQL and credentials in the encrypted secret store. Credentials are
write-only and are never included in the registry read model.

`TEST` is a protocol-aware, replayable command. Its bounded result is persisted
in `integration_probe_observations`; only a successful probe can set health to
`READY`. The adapters perform:

- MCP: Streamable HTTP `initialize`, accepting JSON or SSE JSON-RPC responses;
- n8n: `GET /healthz/readiness`;
- GitHub: authenticated `GET /user` with the current versioned REST headers;
- SSH: TCP handshake and SSH banner validation only, never a remote command.

Remote access is deny-by-default. Add exact hostnames to
`AGENT_WORLD_INTEGRATION_ALLOWED_HOSTS`. If any allowlisted hostname resolves to
private, loopback or link-local space, also set
`AGENT_WORLD_INTEGRATION_PRIVATE_NETWORK_ACK=private-network`. Redirects are not
followed and DNS is resolved before a connection is pinned to the selected
address.

Protocol references:

- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [n8n monitoring endpoints](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/monitor-n8n/)
- [GitHub REST authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
- [GitHub authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
