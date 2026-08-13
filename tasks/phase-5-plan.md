# Phase 5 Plan: Shared Context and RAG

## Outcome

Build one PostgreSQL-owned shared-context plane for every Agent, Account and
execution adapter. A deterministic `ContextCompiler` retrieves only relevant,
provenance-linked state and produces a bounded `ContextPack`; it never forwards
an entire prior transcript by default. PostgreSQL with pgvector remains the
canonical source of truth for documents, chunks and retrieval evidence.

## Fixed boundaries

- `Agent`, `Account`, `Session`, `Task` and `Run` identities remain distinct.
- World and Command consume the same domain contracts and canonical data.
- Context is external to provider threads and survives session replacement.
- Raw model output is evidence, not memory. Structured summaries and explicit
  memory candidates are stored separately with exact Run provenance.
- Every context item and RAG chunk is project-scoped and provenance-linked.
  Cross-project retrieval fails closed even in this single-owner deployment.
- The compiler is deterministic: stable ranking, deduplication, section order,
  content hashes and token fitting do not require an LLM call.
- The token budget covers the rendered pack. Required goal/output/handoff
  sections are reserved before optional retrieval material.
- Skills, artifacts, history and RAG are retrieved by bounded limits; no
  category is loaded wholesale.
- Untrusted retrieved text is clearly delimited as data. It cannot grant tools,
  permissions, network access or override canonical execution policy.

## Threat model

- Prompt injection may arrive through documents, messages, model output or
  artifacts. Retrieved content is labelled untrusted and never interpreted by
  the compiler as policy.
- Poisoned/duplicate embeddings may crowd out useful evidence. Content hashes,
  source uniqueness, per-kind caps and stable deduplication constrain this.
- A malformed embedding or oversized item may cause unbounded work. Schema,
  dimensionality, byte/token limits and query limits fail closed.
- Forged provenance may misattribute evidence. Foreign keys and one canonical
  provenance tuple bind items to existing Project/Task/Run/Event/Artifact rows.

## Slice 1: Versioned domain contracts

Define strict schemas for shared-context items, RAG documents/chunks,
structured Agent output, compiler input, selected evidence and rendered
`ContextPack`.

- [ ] All identifiers are canonical branded IDs.
- [ ] Structured output preserves `fullOutput` but handoff defaults to summary,
      findings, decisions, artifact references and next actions.
- [ ] ContextPack has the required stable sections and exact token accounting.
- [ ] Invalid provenance, unknown sections and oversized content are rejected.

## Slice 2: PostgreSQL + pgvector canonical store

Switch the canonical PostgreSQL image to the pinned official pgvector image,
enable the extension additively and add project-scoped context/RAG tables plus
an HNSW cosine index.

- [ ] Context/RAG writes are parameterized, idempotent and content-hashed.
- [ ] Retrieval filters project before ranking and returns bounded provenance.
- [ ] Duplicate documents/chunks do not create duplicate canonical evidence.
- [ ] Migration, extension, index and restart persistence pass in disposable
      PostgreSQL.

## Slice 3: Deterministic ContextCompiler

Implement the compiler behind a small retrieval port. Rank by temperature,
kind, relevance, importance and recency; deduplicate by content hash; then fit
whole entries into the budget with deterministic truncation only for mandatory
task fields.

- [ ] Required sections always appear in canonical order.
- [ ] Optional entries never exceed their category or total token limits.
- [ ] Full transcripts and full Agent outputs are excluded by default.
- [ ] Identical inputs produce identical pack content and content hash.
- [ ] Huge/duplicate/adversarial context has bounded deterministic behavior.

## Slice 4: Execution integration and structured results

Compile a ContextPack before Codex dispatch, persist the pack/evidence snapshot
against the Run, and pass the rendered pack through the existing adapter
contract. Parse structured output as untrusted data and preserve a bounded raw
fallback when it does not validate.

- [ ] Dispatch records compiler version, pack hash, selected evidence and token
      count before the external turn starts.
- [ ] Adapter receives Task goal plus ContextPack, not prior transcript.
- [ ] Result stores full output and validated structured handoff separately.
- [ ] Restart can recover the exact persisted pack without recompiling drifted
      context.

## Verification gate

- Unit tests prove schemas, ranking, deduplication, token fitting, stable hashes,
  injection delimiters and huge-result behavior.
- Disposable pgvector verification proves extension/index availability,
  project isolation, cosine retrieval, idempotency and persistence.
- Worker integration tests prove exact ContextPack injection and structured
  result persistence without credentials or raw provider events leaking.
- Full type, lint, build, unit, database and Compose gates pass.
- Phase 5 is complete only when a real canonical Run records and uses a bounded
  persisted ContextPack; table presence alone is insufficient.
