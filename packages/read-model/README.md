# @agent-world/read-model

Strict, bounded read projection shared by the World renderer and Command UI.

## Boundary

- Replays versioned canonical `Agent`, `TaskIntent` and `WorldEvent` contracts.
- Produces one schema-validated model with a contiguous World replay cursor.
- Projects the same Agent/status/current-task core into World and Command views.
- Uses deterministic semantic World placement; it owns no runtime sessions or
  renderer state.
- Rejects unknown fields, duplicate identities, broken references, non-contiguous
  replay and configured collection bounds.
- Represents a missing authority as an empty `UNAVAILABLE` model instead of
  synthesizing activity.

The package contains no transport, database or browser dependency. Persistence
and live adapter reconciliation remain server concerns.
