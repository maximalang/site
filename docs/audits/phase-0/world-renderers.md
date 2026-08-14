# World renderer audit

Audit date: 2026-08-13; OpenClaw Office reassessment: 2026-08-14. Every source link is pinned to the SHA recorded in
`upstream-snapshot.md`. The World is a projection of canonical events; none of
the upstream domain stores is eligible to become authoritative state.

## Decision

Replace the initial hand-built `rafapetter/agent-town` Canvas port with a narrow,
attributed presentation port from `WW-AI-Lab/openclaw-office` at
`def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6`. Reuse its React/SVG office,
deterministic SVG characters, furniture, status animation, walking and meeting
mechanics. Feed the port exclusively through a product-owned adapter from the
existing `WorldReadModel` and canonical event cursor.

Do not import its Zustand authority, browser-to-Gateway connection, auth/token
handling, local persistence, chat, console, mock data or OpenClaw session model.
The product keeps PostgreSQL and its canonical Event Stream as the sole truth.
The port is one compact open floor with four legible presentation zones and no
interior room maze. Models, Accounts, Memory, MCP, Servers, Codex and Settings
remain product-native panels/drawers over the World.

`geezerrrr/agent-town` remains the preferred interaction reference because its
OpenClaw task routing and HUD-to-scene bridge are closest to the target. It is
not eligible for code reuse at the audited SHA: the package declares MIT, but
the repository tree has no root license file. Reconsider only after the
copyright owner adds an unambiguous license covering the audited code.

## Candidate findings

| Candidate | Evidence-backed finding | Classification |
| --- | --- | --- |
| `WW-AI-Lab/openclaw-office` | MIT React 19 frontend with a separable SVG office, deterministic SVG avatars, furniture, CSS status animation, walking paths, collaboration links and meeting seating. Its full app directly connects to OpenClaw Gateway and owns Zustand/runtime/UI stores, so the application cannot be adopted as an authority. The shipped office is code-drawn SVG; no third-party sprite/audio pack is required for the selected port. | Primary presentation layer: narrow attributed UI port; reject backend/store/gateway |
| `geezerrrr/agent-town` | Next/React/Phaser implementation with a typed gateway frame, `models.list`/`sessions.list`, and `chat.send` routed by session. The package claims MIT, but no license text exists in the root tree. Its seat/session identity must not become the product Agent identity. | Reference only; license blocker |
| `rafapetter/agent-town` | Canvas 2D library with in-memory agents/tasks/reviews and random idle messages. Its small sizing/hit-testing port proved the canonical read boundary but produced a custom static renderer that no longer matches the product direction. | Superseded initial renderer; remove after parity |
| `eliautobot/my-virtual-office` | Real provider/event work exists, but the repository is AGPL-3.0 and includes a commercial activation system and demo limits. | Reference only; no code movement into core |
| `Pixel-Process-UG/agent-office` | MIT React implementation with provider/state concepts, but explicitly early-development and includes asset provenance that needs a separate audit. | Component reference only |
| `harishkotra/agent-office` | MIT office and task UI wrapped around an autonomous multi-agent simulation. Its agent brain, generated social activity and in-memory task manager duplicate product responsibilities. | Renderer reference; reject runtime |
| `pixel-agents-hq/pixel-agents` | MIT, versioned bidirectional WebSocket protocol and provider normalization. Strong replay/reconnect patterns, but persistent identity is CLI/session/terminal-oriented. | Port protocol patterns, not domain |
| `bagidea/bagidea-office` | MIT, but the primary renderer is Godot desktop. Its documented event journal and actual fail-closed permission hook are useful patterns; plugin execution needs a stronger sandbox. | Reference only |
| `a16z-infra/ai-town` | MIT React/Pixi autonomous world backed by Convex. Character/world techniques are useful; Convex state and token-funded ambient conversations conflict with the architecture. | Visual reference only |

## Key source evidence

- OpenClaw Office declares MIT in its pinned
  [`LICENSE`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/LICENSE)
  and uses React 19, Zustand, SVG/CSS and Vite in
  [`package.json`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/package.json).
- Its [`FloorPlan.tsx`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/components/office-2d/FloorPlan.tsx)
  composes zones, furniture, avatars, collaboration lines and meetings as SVG;
  [`movement-animator.ts`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/lib/movement-animator.ts)
  keeps path interpolation deterministic and independent of an LLM.
- Its [`types.ts`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/gateway/types.ts)
  and [`office-store.ts`](https://github.com/WW-AI-Lab/openclaw-office/blob/def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6/src/store/office-store.ts)
  demonstrate the boundary to replace: upstream visual state is coupled to
  Gateway run/session events and Zustand actions rather than canonical product
  identities and replay.
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

Allowed in the renderer port: OpenClaw Office SVG floor/furniture primitives,
deterministic character generation, status animation, movement interpolation,
meeting seating, collaboration lines, selection and responsive scaling.

Replaced by product contracts: Agent, Account, Task, Run, Session, approval,
message, memory and presence stores; network calls; random dialogue; autonomous
idle decisions; and any direct OpenClaw session-to-seat mapping.

The presentation adapter maps canonical Agent IDs and statuses to renderer-only
positions and animation cues. Map/skin configuration stays behind this adapter
so later visual replacement cannot change domain logic or replay semantics.

Assets are a separate bill of materials. No sprite or sound ships until its
license and attribution are recorded independently of the code license.
