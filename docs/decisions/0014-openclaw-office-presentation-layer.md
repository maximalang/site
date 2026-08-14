# ADR 0014: OpenClaw Office as the World presentation layer

- Status: Accepted
- Date: 2026-08-14
- Supersedes: ADR 0002 renderer selection only

## Context

The initial Agent Town Canvas port proved the important architecture: World and
Command consume the same authenticated `WorldReadModel`, canonical identities
and replay cursor. It is nevertheless a small custom renderer with static
figures and room boxes. Continuing it would turn the product into a game-engine
project and duplicate mature animated agent-office work.

`WW-AI-Lab/openclaw-office` at
`def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6` is MIT-licensed and provides a React
19 SVG office, deterministic generated characters, furniture, status animation,
walking, collaboration links and meeting mechanics. Its full application also
contains OpenClaw Gateway access, Zustand state, local persistence, mock mode,
chat and management consoles that conflict with the canonical product boundary.

## Decision

Use a narrow attributed port of the OpenClaw Office presentation components as
the only World renderer. Reuse the SVG scene, characters, furniture, movement,
status, collaboration and meeting mechanics. Do not reuse its backend,
Gateway/auth clients, runtime/session identity, Zustand authority, persistence,
mock simulation, chat workspace or console stores.

A product-owned pure adapter maps the existing `WorldView` and canonical event
cursor to renderer-only view state:

- canonical Agent ID becomes the stable visual identity and avatar seed;
- canonical statuses select visual states and deterministic destinations;
- Task/Run/Mission/ActionEvents select bounded movement, handoff, review and
  meeting cues as those events become available;
- animation time and positions are ephemeral presentation state and never feed
  back into PostgreSQL or domain decisions;
- clicks call the existing Agent selection/conversation actions.

The office is one compact open floor with three to five understandable zones.
The initial skin uses four: Commons, Focus, Collaboration and Review/Ops. It has
no internal room maze. Memory, Models, Accounts, MCP, Servers, Codex and Settings
open as native AI World panels, terminals, overlays or drawers above the World.

Map geometry, labels, palette and character skin implement a renderer-owned
configuration interface. A later skin/map replacement therefore changes no
domain schema, canonical event, API or orchestration logic.

## Preserved decisions

- PostgreSQL plus the canonical Event Stream remain the sole source of truth.
- World and Command remain two projections of one domain/API layer.
- `Agent != Account`; upstream session/desk identity is discarded.
- No browser-to-OpenClaw Gateway connection or credential exists in the World.
- No random dialogue, simulated work, ambient agent decisions or decorative
  LLM call is permitted.
- Existing owner authentication, approvals and fail-closed unavailable state
  remain unchanged.

## Consequences

- The product stops developing a custom canvas/game engine.
- Upstream presentation fixes can be reviewed and ported against a pinned SHA,
  while the adapter remains small and testable.
- The current Agent Town port and license notice stay until OpenClaw Office
  reaches interaction, accessibility and responsive parity, then are removed in
  a separate auditable migration commit.
- MIT copyright/license text for OpenClaw Office must ship in third-party
  notices. Any later non-code assets require a separate provenance review.

## Rejected alternatives

- Running the full OpenClaw Office app beside AI World: duplicates stores,
  console, auth and Gateway ownership.
- Iframing the upstream app: cannot enforce the shared read model, selection,
  auth or overlay UX boundary.
- Continuing the custom Canvas renderer: creates low-value game-engine work.
- One room per subsystem: produces a navigation maze and confuses presentation
  with system ownership.
- Writing visual activity with LLMs: wastes tokens and fabricates system state.

## Evidence

- <https://github.com/WW-AI-Lab/openclaw-office/tree/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6>
- <https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/LICENSE>
- <https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/components/office-2d/FloorPlan.tsx>
- <https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/lib/movement-animator.ts>
