# Phase 4.5 Plan: Supported Chat Transports

## Outcome

Make `CHAT` a real execution mode without building production runtime on
consumer ChatGPT DOM automation. Provide one automatic upstream-supported path
for managed workspaces and one honest user-assisted path for personal ChatGPT
accounts. Both paths use the canonical Task/Run/Event domain, persisted
ContextPack and structured result contracts.

## Refreshed upstream evidence (2026-08-14)

OpenAI now documents a Workspace Agents API that did not exist in the initial
reuse snapshot:

- `POST https://api.chatgpt.com/v1/workspace_agents/{id}/trigger` durably queues
  a published workspace agent with caller-provided `conversation_key` and an
  optional `Idempotency-Key`.
- A beta run identifier can be polled for queued, in-progress, suspended,
  completed or failed status.
- Authentication uses a Workspace Agent access token scoped to workspace-agent
  operations. A workspace admin must enable both Workspace agents and personal
  access-token creation.
- The trigger API currently returns the ChatGPT conversation URL but explicitly
  does not return the Agent response body.
- ChatGPT web can use remote MCP-backed tools supplied through installed
  plugins, allowing a workspace Agent to submit a structured result to this
  product without reading ChatGPT DOM content.

Sources:

- <https://learn.chatgpt.com/workspace-agents/trigger-runs>
- <https://learn.chatgpt.com/workspace-agents/authentication>
- <https://learn.chatgpt.com/docs/extend/mcp>

## Transport matrix

| Transport | Account requirement | Automation | Result channel | Production status |
| --- | --- | --- | --- | --- |
| `WORKSPACE_CHAT` | Admin-enabled ChatGPT workspace + scoped access token | Automatic | Signed MCP `submit_agent_result` callback | Experimental until live-verified |
| `PERSONAL_CHAT_RELAY` | Any personal ChatGPT account | User-assisted | Owner pastes result into canonical Run | Supported with explicit human step |
| Consumer DOM/browser automation | Consumer session cookie | Apparent automation | Scraped page | Rejected |

## Fixed boundaries

- `Agent != Account`. A published ChatGPT workspace agent is an external
  execution binding, not the canonical Agent identity.
- Workspace access tokens are encrypted secrets and are never exposed to the
  browser, prompt, model, logs or read models.
- The automatic trigger adapter records only bounded validated upstream IDs,
  status, conversation URL origin and failure class.
- A Workspace Agent is instructed to call one capability-scoped MCP callback.
  The callback token is single-Run, short-lived, hashed at rest and cannot read
  other Runs or invoke arbitrary Hub commands.
- A completed upstream status without a valid result callback is
  `RESULT_MISSING`, never a successful canonical Run.
- Personal relay cannot claim `AUTOMATIC`. Owner acknowledgement, exported
  prompt hash, imported result hash and timestamps are immutable provenance.
- Chat prompts contain a persisted ContextPack and no full transcript by
  default.
- No code reads or manipulates `chatgpt.com` DOM, cookies, browser storage or
  private endpoints.

## Slice 1: Versioned transport contracts

- [ ] Add explicit `AUTOMATIC` and `USER_ASSISTED` execution interaction modes.
- [ ] Define strict Workspace trigger/status and Personal relay export/import
      schemas without leaking upstream secrets.
- [ ] Add canonical suspended/waiting states without weakening terminal Run
      invariants.
- [ ] Hub capabilities describe support, automation and prerequisites
      separately.

## Slice 2: Personal Chat Relay

- [ ] Create an idempotent PostgreSQL relay ledger bound to Task, Run, Agent,
      Account, route and persisted ContextPack hash.
- [ ] Owner-only API exports the exact bounded prompt and marks the Run waiting
      for a human relay.
- [ ] Command/World show the same waiting state and a minimal Copy/Open/import
      workflow; no third-party dashboard is required.
- [ ] Imported output is size-bounded, hashed, schema-validated as untrusted
      data and stored with exact owner/action provenance.
- [ ] Duplicate import is idempotent; conflicting import is rejected.

## Slice 3: Workspace Chat adapter

- [ ] Trigger only allowlisted `https://api.chatgpt.com` endpoints with a scoped
      encrypted token and bounded timeout/retry policy.
- [ ] Use canonical idempotency and conversation keys; validate every response.
- [ ] Poll beta status with bounded backoff and normalize all documented HTTP
      and terminal failure classes.
- [ ] Accept result only through a short-lived capability-scoped MCP callback.
- [ ] Reconcile restart, upstream completion without callback and late callback
      deterministically.

## Slice 4: Routing and product truth

- [ ] Personal `CHAT` is selectable only when user-assisted execution is
      acceptable for the Task.
- [ ] Workspace `CHAT` is selectable automatically only when Account, token,
      published trigger and callback integration are ready.
- [ ] Router can fall back among Workspace Chat, Codex, API and local routes;
      it never silently changes an automatic Task into user-assisted work.
- [ ] Every Task surface shows Account, Mode, Adapter and interaction mode.

## Verification gate

- Contract tests cover malicious URLs, forged IDs/status, oversized results,
  duplicate/conflicting import, expired capability and missing callback.
- Disposable PostgreSQL tests prove idempotency, restart recovery and exact
  provenance.
- A deterministic local upstream exercises trigger/status/failure behavior.
- A real Workspace Agent run is required before `WORKSPACE_CHAT` becomes
  production-supported; until then it remains experimental and fail-closed.
- Personal relay must pass an authenticated browser flow at desktop and mobile
  viewports without exposing credentials or claiming autonomous execution.
