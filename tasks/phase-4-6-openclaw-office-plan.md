# Phase 4.6 Plan: OpenClaw Office presentation migration

## Outcome

Replace the static custom Canvas World with an attributed OpenClaw Office SVG
presentation port while preserving the existing PostgreSQL, Event Stream,
`WorldReadModel`, API, authentication, Agent selection and conversation flows.

## Slice 0: Audit gate

- [x] Pin `WW-AI-Lab/openclaw-office` SHA, version and MIT license.
- [x] Inspect its React/SVG components, visual types, movement and store/Gateway
      coupling.
- [x] Record port/reject boundaries in Phase 0 and supersede ADR 0002 with ADR
      0014.
- [x] Confirm selected office visuals are code-drawn; retain a separate audit
      gate for any future images, sprites, audio or fonts.

## Slice 1: Pure renderer adapter

- [x] Define a renderer-only `OfficePresentationModel` with canonical Agent ID,
      display text, visual status, destination zone and optional Action cue.
- [x] Map existing `WorldView` statuses and placements without changing domain
      or read-model schemas.
- [x] Prove stable output for replay, reordered input and skin/map changes.
- [x] Reject unknown/duplicate identities and never map Account/session IDs.

## Slice 2: Attributed OpenClaw Office component port

- [x] Port the minimum SVG floor, furniture, avatar/Pawn and movement primitives
      from pinned upstream with its MIT notice.
- [x] Use one open floor with four zones: Commons, Focus, Collaboration and
      Review/Ops; remove upstream partition walls and doors.
- [x] Render real status/movement only; omit upstream Zustand, Gateway, auth,
      persistence, mock data, chat, console and token stores.
- [x] Preserve selected-Agent click and double-click conversation behavior.

## Slice 3: Native overlays and event cues

- [x] Keep Memory, Models, Accounts, MCP, Servers, Codex and Settings in native
      panels/drawers/terminals above World, not spatial rooms.
- [x] Drive work, handoff, review and structured-meeting cues only from
      canonical events; define truthful fallback when an event type is not yet
      available.
- [x] Ensure animation state cannot invoke commands or mutate canonical state.

The truthful fallback for handoff or meeting activity without a canonical World
event is `NONE`: the renderer shows no action cue. `WORK` and `REVIEW` are pure
status-derived presentation values; neither can dispatch a command.

## Slice 4: Parity, cleanup and release evidence

- [x] Verify desktop and authenticated mobile layouts, keyboard selection,
      reduced motion, touch targets and screen-reader alternative list.
- [x] Verify restart/replay produces the same semantic Agent/status/Task state;
      pixel positions may animate but cannot change truth.
- [x] Remove the Agent Town port and notice only after parity passes; add the
      OpenClaw Office MIT text and pinned SHA to shipped notices/SBOM.
- [x] Run unit, type, lint, build, browser and isolated runtime gates before the
      renderer becomes the production default.
