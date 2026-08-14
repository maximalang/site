# ADR 0002: Primary World renderer

- Status: Superseded by ADR 0014
- Date: 2026-08-13

## Context

The product needs one web renderer driven by real canonical events. The
technically closest candidate, `geezerrrr/agent-town`, has no root license file
at the pinned SHA even though its package metadata says MIT. Other candidates
either bring AGPL/commercial constraints, desktop/Godot architecture, Convex,
or autonomous fictional simulation.

## Decision

Fork/port only the rendering and interaction kernel from
`rafapetter/agent-town` at
`78e8e91b9c2620ff8048377f12048412ed603028` under its MIT license.

Delete or bypass its in-memory Agent/Task/Review authority and random idle
messages. Feed it a product-owned `WorldReadModel` generated from persisted,
typed events. Port specific interaction ideas from other projects only when the
source license permits it and attribution is recorded.

## Consequences

- The first renderer is legally reusable and small enough to isolate.
- The product must build an adapter between canonical events and renderer state;
  this is intentional unique product code.
- `geezerrrr/agent-town` may replace the renderer decision only through a new
  ADR after an unambiguous license appears and the canonical-domain boundary is
  preserved.
- Sprite/audio assets require their own bill of materials before use.
