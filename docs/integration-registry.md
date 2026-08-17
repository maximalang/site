# Integration registry and health probes

The owner-only Hub stores MCP, n8n, GitHub, SSH and Steel endpoint metadata in
PostgreSQL and credentials in the encrypted secret store. Credentials are
write-only and are never included in the registry read model.

`TEST` is a protocol-aware, replayable command. Its bounded result is persisted
in `integration_probe_observations`; only a successful probe can set health to
`READY`. The adapters perform:

- MCP: Streamable HTTP `initialize`, accepting JSON or SSE JSON-RPC responses;
- n8n: `GET /healthz/readiness`;
- GitHub: authenticated `GET /user` with the current versioned REST headers;
- SSH: TCP handshake and SSH banner validation only, never a remote command;
- Steel: `GET /health`, requiring the canonical `{ "status": "ok" }` readiness response.

After a successful probe, the Hub exposes one predefined read-only action per
kind: MCP `tools/list`, n8n workflow listing, GitHub repository listing, SSH
host inspection, or Steel `GET /sessions`. Actions accept no remote path,
method, command or arbitrary parameters. Results are normalized to at most 100
bounded items and persisted in `integration_action_observations`; an exact
`command_id` replay reads the stored result instead of repeating network access.

The Steel surface is deliberately inventory-only. AI World does not expose
Steel session creation, release, scrape, screenshot, PDF, debugger interaction,
navigation, or arbitrary browser commands through the Integration registry.
Browser-session output remains untrusted input. A future write-capable browser
surface requires a separate policy and approval contract rather than extending
`STEEL_LIST_SESSIONS`.

GitHub additionally exposes one write action in Advanced mode: an existing
`workflow_dispatch` workflow can be requested with bounded owner/repository,
workflow and ref fields. Request and owner decision are separate commands. The
PostgreSQL lifecycle is `PENDING -> DENIED` or
`PENDING -> EXECUTING -> SUCCEEDED|FAILED|OUTCOME_UNKNOWN`; network execution
starts only after approval. A connection failure after sending is terminal
`OUTCOME_UNKNOWN` and is never retried automatically. The executor accepts only
the canonical GitHub dispatch path and pinned, allowlisted HTTPS connection.

MCP writes use a second, narrower registry. The owner first selects an exact
tool returned by a fresh `tools/list` discovery and stores immutable, bounded
JSON arguments in `integration_tool_allowlist`. A Run or UI caller can request
only the resulting allowlist ID; it cannot supply a tool name or arguments at
invocation time. The same separate approval lifecycle applies, and the
executor resolves the tool and fixed arguments inside the approval transaction
before calling `tools/call`. JSON-RPC rejection is a definite failure; an
invalid response or transport/server interruption after dispatch is
`OUTCOME_UNKNOWN` and is not retried. Docker MCP Gateway remains the preferred
reused isolation/profile/secrets layer; AI World owns only its canonical
allowlist, approval and event evidence.

SSH service/deployment writes use `integration_ssh_operation_allowlist` and the
same durable approval lifecycle. The registry accepts only two typed operations:
a validated systemd unit restart or a Docker Compose deployment whose project
name and absolute working directory satisfy strict non-shell grammars. The
caller sends only the registered operation ID. The executor derives the command,
uses the encrypted private key, resolves only an allowlisted host, and requires
an exact conventional `SHA256:<base64>` host-key fingerprint supplied through a trusted provisioning
channel. It allocates no PTY, bounds output, and never exposes a shell or raw
command field. A transport interruption after dispatch is terminal
`OUTCOME_UNKNOWN` and is not retried.

Remote access is deny-by-default. Add exact hostnames to
`AGENT_WORLD_INTEGRATION_ALLOWED_HOSTS`. If any allowlisted hostname resolves to
private, loopback or link-local space, also set
`AGENT_WORLD_INTEGRATION_PRIVATE_NETWORK_ACK=private-network`. Redirects are not
followed and DNS is resolved before a connection is pinned to the selected
address.

Protocol references:

- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [Docker MCP Gateway](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/)
- [n8n monitoring endpoints](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/monitor-n8n/)
- [GitHub REST authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
- [GitHub authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
- [GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [`ssh2` client API and host verification](https://github.com/mscdex/ssh2)
