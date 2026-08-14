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

The supported upstream baseline is Graphiti `v0.29.3` at commit
`021d3a57d511f21b10adaf7fa923bd5c1fce5e9d`. This release fixes FalkorDB
single-group routing and MCP restart behavior. The currently published
`zepai/knowledge-graph-mcp:1.0.2-graphiti-0.28.2` image is intentionally not a
production pin because it predates those fixes and may expose the older tool
schema. Activation therefore requires either an upstream image built from the
pinned release or a reproducible source build of that exact commit.

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

