# Phase 0 reuse matrix

Status: decision baseline, 2026-08-13. “Port” means manually adapt a small,
attributed component into product contracts. “Service” means run separately
behind an adapter. Neither classification overrides the upstream license.

| Component | Verified license boundary | Decision | What is reused | Why / constraint |
| --- | --- | --- | --- | --- |
| `openclaw/openclaw` | MIT root | Reuse as service + adapter | Public gateway client/protocol and plugin SDK | Sole general runtime; internals and config are not canonical APIs |
| `geezerrrr/agent-town` | No root license; package metadata says MIT | Reference only | Interaction/task-flow ideas | Copyright permission is not established at pinned SHA |
| `rafapetter/agent-town` | MIT | Narrow fork/port | Canvas renderer, layout, pathfinding, interaction | Primary World renderer; replace stores and random simulation |
| `eliautobot/my-virtual-office` | AGPL-3.0 plus commercial feature gate | Reference only | Provider/event and office concepts | No code movement into permissive core |
| `Pixel-Process-UG/agent-office` | MIT code; assets need separate review | Port selected components only | Office UI/provider patterns | Early-development APIs and non-code asset provenance |
| `harishkotra/agent-office` | MIT | Reference UI; reject runtime | Office/task presentation ideas | Autonomous social brain duplicates runtime and emits fictional activity |
| `pixel-agents-hq/pixel-agents` | MIT | Port protocol patterns | Versioned normalized events, replay/reconnect | CLI/session identity is not canonical Agent identity |
| `bagidea/bagidea-office` | MIT; assets need separate review | Reference only | Event-journal and fail-closed permission patterns | Godot desktop renderer and unsafe arbitrary plugin host do not fit web core |
| `a16z-infra/ai-town` | MIT | Reference only | Character/world rendering techniques | Convex authority and token-funded ambient chatter conflict with requirements |
| `TianyiDataScience/openclaw-control-center` | MIT | Port selected UI | Audit/operator panels and stream UX | JSON stores and synthetic dispatch messages are rejected |
| `daggerhashimoto/openclaw-nerve` | MIT | Port selected UI after rewrite | Fleet/session/workspace interaction patterns | Local filesystem authority and browser-stored token are rejected |
| `openagents-org/openagents` | Apache-2.0 | Reference only | Connector/event normalization | Hosted default and unsafe Codex flags violate trust boundary |
| `iOfficeAI/AionUi` | Apache-2.0 | Port selected components | Runtime selector, persona/backend split, safe skill paths | Electron/Rust persistence and provider model arrays are replaced |
| `BerriAI/litellm` | MIT core; `enterprise/` separate | Reuse as service | First model gateway core | One pinned release; product `ModelGateway` preserves replacement path |
| `maximhq/bifrost` | Apache-2.0 repo; advertised enterprise feature boundary | Adapter target/reference | Alternative high-performance gateway | Do not run beside LiteLLM; validate required feature tier before swap |
| `langchain-ai/langgraph` | MIT | Direct library | Durable workflow/checkpoint/interrupt primitives | Orchestration only; Postgres product domain remains authoritative |
| `getzep/graphiti` | Apache-2.0 | Reuse as library/service adapter | Temporal fact/episode graph | Memory subsystem; provenance links back to canonical records |
| `FalkorDB/FalkorDB` | SSPL-1.0 | Isolated service | Graphiti-supported graph database | No code copying; network/distribution obligations are a release gate |
| `pgvector/pgvector` | PostgreSQL License | Direct extension | Vector columns and HNSW/IVFFlat | Keeps RAG documents/chunks in canonical Postgres |
| `jacomyal/sigma.js` | MIT | Direct library | Large read-only graph renderer | Memory Network UI only |
| `graphology/graphology` | MIT | Direct library | In-browser graph data/algorithms | Data model for Sigma projection only |
| `xyflow/xyflow` | MIT | Direct library | Editable graph/action UI | Never used as execution engine |
| `langfuse/langfuse` | MIT core; `ee/` paths separate | Isolated service | Low-level traces/evals through adapter | Product Observatory is user surface; Action Graph remains truth |
| `n8n-io/n8n` | Sustainable Use core; enterprise code separate | Optional isolated service | Integration/workflow bus | Not agent brain; no code copying; exact use must pass license review |
| `docker/mcp-gateway` | MIT | Service/adapter after VDS spike | Containerized MCP aggregation | Linux secrets/OAuth parity and failure isolation require verification |
| `steel-dev/steel-browser` | Apache-2.0 | Optional isolated service | Persistent browser session lifecycle | Approved sites only; output untrusted; no consumer ChatGPT foundation |
| `openai/codex` | Apache-2.0 | Official SDK adapter | Specialist coding threads, streamed events, approvals | Prefer supported SDK; direct WebSocket remains experimental-gated |

## Composition invariants

1. One canonical PostgreSQL domain and one event ledger feed both World and
   Command.
2. One general runtime (OpenClaw), one primary renderer (the narrow Agent Town
   fork), and one first model gateway (LiteLLM) are enabled.
3. Codex, Graphiti, Langfuse, n8n, MCP Gateway and Steel are adapters/services,
   never alternative owners of Agent, Task, Run, policy or audit truth.
4. No AGPL, SSPL, Sustainable Use, enterprise, commercial or unlicensed code is
   copied into the permissive product core.
5. License texts, notices, component versions, image digests and asset
   attribution form a generated release bill of materials.

## Release blockers discovered by the audit

- Resolve or permanently avoid the missing `geezerrrr/agent-town` license.
- Complete a legal/use review for FalkorDB and n8n under the intended personal
  self-hosted and any future distribution/network-access model.
- Verify Docker MCP Gateway secrets/OAuth on the actual Linux VDS.
- Recheck current Codex transport maturity at Phase 4; do not ship direct
  app-server WebSocket while official documentation calls it unsupported.
- Audit all visual/audio assets separately from repository code licenses.
