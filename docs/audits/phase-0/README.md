# Phase 0 OSS reuse audit

Audit date: 2026-08-13 (Europe/Moscow)

This directory contains the evidence gate required by ADR-0001. Upstream clones
live under ignored `.research/upstream/`; recommendations must cite immutable
commit SHAs and source paths, not just moving branches or README summaries.

## Required outputs

- `upstream-snapshot.md` — repository identity, branch, SHA, release and license
  metadata observed at audit start.
- `world-renderers.md` — World/office renderer comparison.
- `runtime-control-plane.md` — OpenClaw and control-plane comparison.
- `infrastructure-components.md` — gateway, orchestration, memory, RAG,
  observability, automation, browser and MCP comparison.
- `reuse-matrix.md` — final classification and obligations for every candidate.

## Evidence rules

1. Prefer LICENSE/NOTICE, source code, manifests and official documentation.
2. Pin every code citation to the SHA in `upstream-snapshot.md`.
3. Treat GitHub license metadata as a hint; inspect actual license files.
4. Treat missing or unclear license as reference-only.
5. Distinguish reusable code from reusable architecture or UX patterns.
6. Do not infer a stable public API from an internal module without evidence.
