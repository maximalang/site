# Infrastructure component audit

Audit date: 2026-08-13. “Service” means a separately deployed, pinned component
behind a product-owned adapter. It does not grant permission to copy its code.

## Initial composition

| Capability | First component | Boundary and reason |
| --- | --- | --- |
| Model gateway | LiteLLM core | Run a pinned release as one gateway; MIT core already has virtual keys, spend, routing and guardrails. Never import `enterprise/`. Keep a `ModelGateway` interface so Bifrost can replace it. |
| Orchestration | LangGraph | Library behind product workflow interfaces; durable execution and interrupts fit long-running review/approval graphs. |
| Temporal memory | Graphiti + FalkorDB | Graphiti adapter over a separately deployed FalkorDB. FalkorDB is SSPL: no code copying and re-evaluate obligations before any third-party service/distribution. |
| RAG | PostgreSQL + pgvector | Direct extension in canonical Postgres; documents/chunks remain relational and provenance-linked. |
| Memory graph UI | Sigma.js + Graphology | Direct MIT libraries for large read-only graphs. |
| Editable graphs | React Flow | Direct MIT library for workflows/action views, not a runtime engine. |
| Telemetry | Langfuse core | Separate pinned service; product Observatory is the only user-facing surface. Exclude `ee/` paths and scrub secrets/content by policy. |
| Automation | n8n | Optional isolated service, not agent brain or source of truth. Sustainable Use/enterprise terms prohibit copying into core and require a deployment-use review. |
| MCP isolation | Docker MCP Gateway | Adapter/prototype first; verify Linux VDS support for secrets and OAuth rather than assuming Docker Desktop feature parity. |
| Browser sessions | Steel | Optional isolated Apache-2.0 service for approved persistent sessions. Browser output is untrusted input and consumer-site automation remains policy-gated. |

## Gateway choice: LiteLLM first, Bifrost replaceable

The product brief explicitly selects LiteLLM first. The audit supports that
choice with a strict boundary: only the MIT core and a pinned release image are
eligible. Its root license excludes `enterprise/`, and the public README lists
the required gateway primitives. Bifrost remains the performance alternative,
but some advertised governance/MCP capabilities are described as enterprise
features. Running both would duplicate routing and cost authority.

Evidence:

- LiteLLM's root license separates MIT core from
  [`enterprise/`](https://github.com/BerriAI/litellm/blob/d86336a7c6f5c97b5fb46413a8a1c9d77f426220/LICENSE#L1-L8),
  and its [README](https://github.com/BerriAI/litellm/blob/d86336a7c6f5c97b5fb46413a8a1c9d77f426220/README.md#L55-L65)
  lists virtual keys, spend, guardrails and load balancing.
- Bifrost's [README](https://github.com/maximhq/bifrost/blob/c556c60c582e3d4d32a53b206d129648f076e628/README.md#L55-L98)
  distinguishes enterprise features while documenting fallback, load balancing
  and budgets. It stays behind the same product-owned interface.

## Memory, RAG and graph UI

- Graphiti provides temporal validity and lists FalkorDB as a supported backend
  in its [README](https://github.com/getzep/graphiti/blob/d40da88f202c0eba5b2c4164d1c912bd663a0159/README.md#L129-L185).
- FalkorDB's license is
  [SSPL](https://github.com/FalkorDB/FalkorDB/blob/8512cbad3da9b881bdd5a1ece0ae6f9b6778891e/LICENSE#L1-L15)
  and contains service-source obligations. This is a compliance boundary, not a
  permissive dependency.
- pgvector keeps similarity search in Postgres and supports HNSW/IVFFlat as
  documented in its [README](https://github.com/pgvector/pgvector/blob/521957586f952754bd631159bb03e9f30fdb9b2a/README.md#L3-L12)
  and [index section](https://github.com/pgvector/pgvector/blob/521957586f952754bd631159bb03e9f30fdb9b2a/README.md#L203-L215).
- Sigma is a WebGL renderer for large graphs built on Graphology according to
  its [README](https://github.com/jacomyal/sigma.js/blob/d32c4e5bfd4c5f49724ebc21bd786b01be555dac/README.md#L10-L20).
  React Flow is an MIT node-editor library, not an orchestrator, per its
  [README](https://github.com/xyflow/xyflow/blob/6eee160629a1c29267e1ae35ecabf4c9cc8d63e1/README.md#L6-L21).

## Operations, telemetry and tools

- LangGraph documents durable execution and human-in-the-loop in its
  [README](https://github.com/langchain-ai/langgraph/blob/644815f9e5bc52ad8f7a5227a456227e9c3e639b/README.md#L35-L42).
- Langfuse's root license excludes enterprise paths from its MIT core in
  [`LICENSE`](https://github.com/langfuse/langfuse/blob/f1206115b29d8ddc83a51350834ccd7f8c2fba2f/LICENSE#L1-L10).
- n8n's [license](https://github.com/n8n-io/n8n/blob/cbb55770537b0874f684dab9dda992d461bd577a/LICENSE.md#L1-L18)
  is Sustainable Use for eligible core files and separately licenses enterprise
  code. It is not a permissive library dependency.
- Docker MCP Gateway documents container isolation, secrets, OAuth and dynamic
  discovery in its [README](https://github.com/docker/mcp-gateway/blob/24b028f4f9aac85ce1a1057c5e8d739836e7c18d/README.md#L20-L34).
- Steel documents CDP plus Playwright/Puppeteer/Selenium and self-hosted SDK
  targeting in its [README](https://github.com/steel-dev/steel-browser/blob/5880b48c1af107219ff3d904edbb8f6b76bea9b6/README.md#L45-L52)
  and [SDK section](https://github.com/steel-dev/steel-browser/blob/5880b48c1af107219ff3d904edbb8f6b76bea9b6/README.md#L169-L184).

## One-VDS deployment constraints

- Core profile: product web/API, worker, PostgreSQL+pgvector, Redis only when a
  measured queue/cache need exists, and one LiteLLM gateway.
- Optional memory profile: Graphiti worker/API plus FalkorDB.
- Optional observability profile: Langfuse and its required stores, with explicit
  resource budgets and retention.
- Optional integrations profile: n8n, Docker MCP Gateway and Steel.
- No raw third-party admin UI is publicly routed. Health endpoints do not prove
  application readiness; each adapter needs a contract probe.
- Every image is pinned by digest for production, with backup/restore and upgrade
  tests before enablement. `latest` is documentation-only.

This is an engineering classification, not legal advice. SSPL, Sustainable Use,
AGPL and open-core boundaries require confirmation against the exact intended
distribution and network-access model before release.
