# Graphiti memory projection

PostgreSQL owns proposals, curation decisions, accepted `MEMORY` ContextItems,
the append-only memory event stream and the Graphiti projection checkpoint.
Graphiti/FalkorDB is an optional, rebuildable temporal graph projection.

The adapter projects only curated `ACCEPT` and `MERGE` events. Proposals and
rejections advance replay without spending model tokens. Every episode uses the
canonical Project as `group_id`, the event UUID as its deterministic Graphiti
episode UUID, and the canonical event time as `reference_time`.

The adapter fails readiness unless the live `add_memory` tool exposes
`reference_time`, `uuid`, `group_id`, `episode_body` and the other pinned
inputs. This prevents an older container from accepting a checkpoint while
silently losing temporal or idempotency provenance.

The supported upstream MCP baseline is Graphiti `v0.29.3` at commit
`021d3a57d511f21b10adaf7fa923bd5c1fce5e9d`. This release fixes FalkorDB
single-group routing and MCP restart behavior. The currently published
`zepai/knowledge-graph-mcp:1.0.2-graphiti-0.28.2` image is intentionally not a
production pin because it predates those fixes and may expose the older tool
schema. Activation therefore requires either an upstream image built from the
pinned release or a reproducible source build of that exact commit.

The optional `graph-memory` Compose profile builds that exact source archive,
verified as SHA-256
`261607de05c63149574448de3120033dc296709e620ad1524a6aa7b44f816914`.
It uses the upstream frozen MCP lock, which pins `graphiti-core==0.29.2`, a
digest-pinned Python base and digest-pinned `uv`. FalkorDB is pinned to
`v4.20.1` by manifest digest. No host port is published by the deployment.
Both services remain on the private `data` network, and Graphiti is a
non-root, read-only container.

Enable the projection only after LiteLLM has working chat and embedding routes:

```powershell
$env:AGENT_WORLD_GRAPHITI_MCP_URL='http://graphiti:8000/mcp/'
$env:AGENT_WORLD_GRAPHITI_PLAINTEXT_ACK='private-network'
docker compose --profile graph-memory up -d --build
```

`MODEL_NAME` and `EMBEDDER_MODEL` are routed through the existing private
LiteLLM service. Graphiti receives the LiteLLM master key only inside the
private network. It does not receive the owner password, PostgreSQL URL, Chat
account sessions or browser state. An accepted/merged event may spend model
tokens during graph extraction; proposals, rejections, replay skips and the
World animation never do.

When `AGENT_WORLD_GRAPHITI_MCP_URL` is configured, the web runtime starts one
bounded polling supervisor. It consumes the canonical PostgreSQL stream in
sequence, advances the PostgreSQL checkpoint only after an exact adapter
acknowledgement, and treats Graphiti failures as projection failures rather
than canonical-runtime failures. `AGENT_WORLD_GRAPHITI_POLL_MS` defaults to
5000; invalid timing disables only the optional projection and emits bounded
telemetry.

Readiness-only verification performs no graph write and no LLM call:

```powershell
$env:AGENT_WORLD_GRAPHITI_LIVE_ACK='readiness-only'
$env:AGENT_WORLD_GRAPHITI_MCP_URL='https://graphiti.internal.example/mcp/'
npm.cmd run build --workspace @agent-world/graphiti-adapter
npm.cmd run test:live --workspace @agent-world/graphiti-adapter
```

For an internal plaintext Compose network, explicitly set
`AGENT_WORLD_GRAPHITI_PLAINTEXT_ACK=private-network`. Credential-bearing URLs
are rejected; provider secrets belong only in the isolated Graphiti service.

Primary references:

- <https://github.com/getzep/graphiti/releases/tag/v0.29.3>
- <https://github.com/getzep/graphiti/tree/v0.29.3/mcp_server>
- <https://github.com/FalkorDB/FalkorDB/blob/master/LICENSE>
