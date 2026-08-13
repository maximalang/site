# Current task list

## Task 1: Establish the Phase 0 evidence baseline

**Description:** Record the clean workspace state and pin every named upstream
to a branch, commit and observed release as of the audit date.

**Acceptance criteria:**

- [x] Workspace and Git state are inspected.
- [x] All named repositories resolve to an official GitHub repository.
- [x] Default branches and immutable HEAD SHAs are recorded.

**Verification:**

- [x] Re-run `git ls-remote` and compare with the recorded snapshot; 26/27 still
      matched and OpenClaw drift was recorded without rewriting the audit SHA.
- [x] Every source URL resolves and all 27 repositories are non-archived.

**Dependencies:** None

**Files likely touched:**

- `docs/audits/phase-0/upstream-snapshot.md`
- `docs/audits/phase-0/README.md`

**Estimated scope:** Small

## Task 2: Audit World renderer candidates

**Description:** Clone and inspect the seven World/office repositories, including
domain model, renderer, realtime/event adapters, task interaction and license.

**Acceptance criteria:**

- [x] One primary renderer is selected with evidence.
- [x] Reusable modules and incompatible domain assumptions are identified.
- [x] AGPL and missing-license boundaries are explicit.

**Verification:**

- [x] Findings cite pinned source paths and commit SHAs.
- [x] No recommendation depends only on README claims.

**Dependencies:** Task 1

**Files likely touched:**

- `docs/audits/phase-0/world-renderers.md`
- `docs/decisions/0002-primary-world-renderer.md`

**Estimated scope:** Medium

## Task 3: Audit runtime and control-plane candidates

**Description:** Inspect OpenClaw, Control Center, Nerve, OpenAgents and AionUi
for stable extension contracts, reusable UI modules and source-of-truth risks.

**Acceptance criteria:**

- [x] OpenClaw adapter boundary is identified.
- [x] Reusable control-plane components are mapped to canonical domain objects.
- [x] Runtime projections are separated from canonical persistence.

**Verification:**

- [x] Findings cite typed APIs and package boundaries at pinned SHAs.
- [x] License and attribution requirements are recorded.

**Dependencies:** Task 1

**Files likely touched:**

- `docs/audits/phase-0/runtime-control-plane.md`

**Estimated scope:** Medium

## Task 4: Audit infrastructure candidates

**Description:** Inspect model gateways, orchestration, memory, RAG, graph UI,
observability, automation, browser and MCP projects.

**Acceptance criteria:**

- [x] Each component has a reuse classification and interface boundary.
- [x] LiteLLM versus Bifrost is decided for the first production gateway.
- [x] Operational and license constraints for one-VDS deployment are explicit.

**Verification:**

- [x] Findings use official docs plus pinned source files.
- [x] Compose/profile implications are documented.

**Dependencies:** Task 1

**Files likely touched:**

- `docs/audits/phase-0/infrastructure-components.md`

**Estimated scope:** Medium

## Task 5: Publish reuse matrix and architecture gate

**Description:** Consolidate the audit into the required decision matrix and ADRs,
then decompose Phase 1 into vertical, verifiable slices.

**Acceptance criteria:**

- [x] Every named project is classified with reason and license obligations.
- [x] The composition contains one runtime, renderer and first model gateway.
- [x] Phase 1 tasks are small, dependency-ordered and testable.

**Verification:**

- [x] Audit completeness checklist passes for 27/27 repositories, required
      outputs, Phase 0 checkboxes, root scope and `git diff --check`.
- [x] All unresolved items are explicit blockers or deferred decisions.

**Dependencies:** Tasks 2-4

**Files likely touched:**

- `docs/audits/phase-0/reuse-matrix.md`
- `docs/decisions/0001-reuse-before-build.md`
- `tasks/plan.md`
- `tasks/todo.md`

**Estimated scope:** Medium

## Checkpoint: Phase 0 complete

- [x] Audit gate in `tasks/plan.md` is satisfied.
- [x] No production implementation was added before the gate.
- [x] Phase 1 can begin with a selected composition; avoided licenses remain
      explicit release gates rather than renderer/runtime ambiguity.
