# World renderer audit

Audit date: 2026-08-13. Every source link is pinned to the SHA recorded in
`upstream-snapshot.md`. The World is a projection of canonical events; none of
the upstream domain stores is eligible to become authoritative state.

## Decision

Use a narrow fork/port of `rafapetter/agent-town` as the first web renderer.
It is MIT-licensed, framework-agnostic, Canvas 2D, and has no runtime
dependencies. Replace its in-memory agent/task/review stores and random idle
simulation with a typed read model supplied by the product API.

`geezerrrr/agent-town` remains the preferred interaction reference because its
OpenClaw task routing and HUD-to-scene bridge are closest to the target. It is
not eligible for code reuse at the audited SHA: the package declares MIT, but
the repository tree has no root license file. Reconsider only after the
copyright owner adds an unambiguous license covering the audited code.

## Candidate findings

| Candidate | Evidence-backed finding | Classification |
| --- | --- | --- |
| `geezerrrr/agent-town` | Next/React/Phaser implementation with a typed gateway frame, `models.list`/`sessions.list`, and `chat.send` routed by session. The package claims MIT, but no license text exists in the root tree. Its seat/session identity must not become the product Agent identity. | Reference only; license blocker |
| `rafapetter/agent-town` | Canvas 2D library with in-memory agents/tasks/reviews and random idle messages. Renderer, layout, movement and hit-testing are separable; stores and simulation are not. | Primary renderer fork/port |
| `eliautobot/my-virtual-office` | Real provider/event work exists, but the repository is AGPL-3.0 and includes a commercial activation system and demo limits. | Reference only; no code movement into core |
| `Pixel-Process-UG/agent-office` | MIT React implementation with provider/state concepts, but explicitly early-development and includes asset provenance that needs a separate audit. | Component reference only |
| `harishkotra/agent-office` | MIT office and task UI wrapped around an autonomous multi-agent simulation. Its agent brain, generated social activity and in-memory task manager duplicate product responsibilities. | Renderer reference; reject runtime |
| `pixel-agents-hq/pixel-agents` | MIT, versioned bidirectional WebSocket protocol and provider normalization. Strong replay/reconnect patterns, but persistent identity is CLI/session/terminal-oriented. | Port protocol patterns, not domain |
| `bagidea/bagidea-office` | MIT, but the primary renderer is Godot desktop. Its documented event journal and actual fail-closed permission hook are useful patterns; plugin execution needs a stronger sandbox. | Reference only |
| `a16z-infra/ai-town` | MIT React/Pixi autonomous world backed by Convex. Character/world techniques are useful; Convex state and token-funded ambient conversations conflict with the architecture. | Visual reference only |

## Key source evidence

- `geezerrrr/agent-town` declares MIT only in
  [`package.json`](https://github.com/geezerrrr/agent-town/blob/e81a218dd376f37870290cc0c307a165475a303d/package.json#L1-L8),
  routes work through `chat.send` in
  [`useTaskRouter.ts`](https://github.com/geezerrrr/agent-town/blob/e81a218dd376f37870290cc0c307a165475a303d/lib/hooks/useTaskRouter.ts#L27-L65),
  and reads gateway models/sessions in
  [`gateway-handler.ts`](https://github.com/geezerrrr/agent-town/blob/e81a218dd376f37870290cc0c307a165475a303d/lib/gateway-handler.ts#L75-L110).
- `rafapetter/agent-town` keeps its own maps and idle simulation in
  [`AgentTown.ts`](https://github.com/rafapetter/agent-town/blob/78e8e91b9c2620ff8048377f12048412ed603028/src/AgentTown.ts#L80-L135).
  Those lines define the boundary to delete, not an authority to preserve.
- Pixel Agents defines a versioned normalized event contract in
  [`provider.ts`](https://github.com/pixel-agents-hq/pixel-agents/blob/0f823e2842b66e472aab747829fd05b7a5c655c4/core/src/provider.ts#L14-L84)
  and a bidirectional protocol in
  [`asyncapi.yaml`](https://github.com/pixel-agents-hq/pixel-agents/blob/0f823e2842b66e472aab747829fd05b7a5c655c4/core/asyncapi.yaml#L1-L18).
- My Virtual Office's commercial activation boundary is explicit in
  [`app/license.py`](https://github.com/eliautobot/my-virtual-office/blob/0c8ff7e9abaee3d02117decbe1f1bbd6ffeafd76/app/license.py#L1-L45).
- Pixel & Process labels its API unstable in its
  [README](https://github.com/Pixel-Process-UG/agent-office/blob/da62eee3bb054d0500b15ace53dd005adcfa512d/README.md#L1-L8).
- BagIdea's permission hook defaults non-read tools to deny in
  [`daemon/perm.js`](https://github.com/bagidea/bagidea-office/blob/a4f69333ce2fcd9feef3a73642d5c6c270a6c36a/daemon/perm.js#L1-L52).
- AI Town directly depends on Convex and Pixi in
  [`package.json`](https://github.com/a16z-infra/ai-town/blob/7b242334bfbfef02f7718bded120d431e8f307df/package.json#L1-L31).

## Porting boundary

Allowed in the renderer fork: drawing, camera, layout, pathfinding, sprite
animation, hit testing, selection and deterministic visual transitions.

Replaced by product contracts: Agent, Account, Task, Run, Session, approval,
message, memory and presence stores; network calls; random dialogue; autonomous
idle decisions; and any direct OpenClaw session-to-seat mapping.

Assets are a separate bill of materials. No sprite or sound ships until its
license and attribution are recorded independently of the code license.
