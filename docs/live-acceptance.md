# AI World live acceptance runbook

This runbook is the final owner/environment gate after repository CI is green.
It does not replace the authoritative product matrix in
`docs/audits/acceptance-2026-08-18.md` and it must not be satisfied with fixtures.

The three proofs are intentionally separated:

1. Native Plus Chat terminal MCP/App run;
2. approved bounded SSH operation against a real provisioned host;
3. real ChatGPT-authenticated Codex Run with terminal provenance.

A failure in one surface must not be hidden by success in another.

## 0. Public production preflight

Run this from a trusted machine against the real AI World HTTPS origin before
starting any owner-authenticated test:

```sh
npm run test:production-preflight -- https://ai-world.example.com
```

The command is read-only and does not require a bearer token. It fails unless it
can prove all of the following on the same production origin:

- `/api/health/live` and `/api/health/ready` are healthy over HTTPS;
- HSTS is present and the public `Server` header is removed;
- RFC 9728 protected-resource metadata advertises the exact `/api/mcp` resource;
- the OAuth issuer is the isolated AI World `/oauth` issuer;
- Authorization Code, rotating-refresh capability, public-client DCR, PKCE S256,
  `offline_access` and `ai_world.run.write` are advertised;
- the public JWKS contains an ES256-compatible P-256 key and no private `d` value;
- unauthenticated MCP access fails closed with the correct
  `WWW-Authenticate` resource-metadata challenge;
- Native Chat launcher control is configured and rejects an unauthenticated
  claim with `401`, rather than being silently disabled;
- the Custom GPT Actions fallback exposes the same five bounded Control
  operations and OAuth issuer.

A `PASS` result means the public control plane is ready for the owner tests. It
is not evidence that Plus Chat, SSH or Codex themselves have completed a real
Run.

## 1. Native Plus Chat proof — product criterion 4

### Preconditions

- `AGENT_WORLD_MCP_ENABLED=true` on production;
- production OAuth keys/cookie keys exist outside the repository and are mounted
  read-only;
- one canonical `CHATGPT_INTERACTIVE` Account with CHAT surface is configured;
- the Account has an enabled Native Plus Chat launcher mapping;
- the server has a fixed launcher ID plus only the SHA-256 verifier of the
  launcher token;
- the owner laptop holds the raw launcher token and a dedicated browser profile;
- the AI World GPT/App is connected to the production MCP resource.

### Host-local launcher

On the owner laptop:

```powershell
npm.cmd run build --workspace @agent-world/native-chat-launcher
npm.cmd start --workspace @agent-world/native-chat-launcher
```

The launcher may only claim a queued dispatch, open/select the dedicated ChatGPT
profile, submit the canonical `run_id` and record its submission receipt. It
must not inspect or scrape Chat output.

### Real Run

Create/approve one small Task whose broker-selected execution surface is the
configured CHAT Account. Use a task with a deterministic, non-destructive result
so the terminal structured output is easy to inspect.

The real ChatGPT execution must complete this control sequence through MCP/App:

```text
run_id
  -> begin_run
  -> get_run_resources (only resources actually needed)
  -> optional structured progress events
  -> commit_result
```

`fail_run` is a valid terminal protocol outcome for an actual execution failure,
but it does not satisfy the successful acceptance proof.

### PASS evidence

Record the canonical Run ID and verify in AI World that:

- the browser submission receipt exists;
- `BEGIN_RUN` is persisted for the same Run and Account;
- at least one bounded resource-pull receipt exists;
- the terminal event is `COMMIT_RESULT`;
- the Run is completed rather than inferred from visible Chat DOM text;
- the structured result is stored before the terminal Chat response;
- resulting Action/Memory provenance points back to the same Run;
- Account, CHAT mode and selected Route provenance are visible.

Only then change criterion 4 from `PARTIAL` to `PASS`.

## 2. Real SSH proof — product criterion 18

### Preconditions

Configure one real SSH integration in Hub with:

- an explicit hostname/address allowed by policy;
- a dedicated least-privilege SSH credential;
- the real SHA-256 host-key fingerprint pinned in AI World;
- private-network acknowledgement only when the target actually requires it;
- one predefined bounded operation already represented by the product schema.

Do not enable a generic shell, PTY or arbitrary command string for this test.

### Recommended proof operation

Prefer a read-only registered operation such as service status or Compose status.
If the chosen registered operation is mutating, use a disposable/non-critical
target and verify the approval text before executing it.

Create the integration action from AI World, approve it through the normal durable
approval flow, then execute it from the product.

### PASS evidence

Record the integration action/approval identifiers and verify:

- request state was persisted before approval;
- an explicit owner approval exists;
- execution entered the durable `EXECUTING` state only after approval;
- the connection used the configured pinned host key;
- the operation was one of the registered bounded operations;
- no PTY/raw-shell path was exposed;
- stdout/stderr evidence is bounded and stored in the terminal action result;
- the action reached the expected terminal success state.

Only then change criterion 18 from `PARTIAL` to `PASS`.

## 3. Real Codex production-activation proof

Repository CI proves the official Codex SDK/CLI adapter contract, but that is not
a real owner-authenticated production Run.

### Authenticate the dedicated worker

On the AI World deployment host:

```sh
docker compose -p agent-world run --rm codex-worker codex login --device-auth
docker compose -p agent-world run --rm codex-worker codex login status
docker compose -p agent-world up -d --wait codex-worker
```

Do not copy/read Codex credential files into AI World logs or product storage.

### Real Run

Create one small Task whose selected Route is the configured Codex Account and
whose project root is inside `AGENT_WORLD_CODEX_PROJECT_ROOT`. Prefer a harmless
read-only repository analysis for the activation proof; no production code
mutation is required just to prove authentication/execution.

### PASS evidence

Record the canonical Run ID and verify terminal provenance includes the real:

- Account ID;
- CODEX mode/Route;
- Codex thread/turn identifiers where supplied by the official runtime;
- model/runtime evidence;
- sandbox/working-root evidence;
- terminal status and usage evidence.

A deterministic CI verifier, a rejected allowance test or merely successful
`codex login status` is not sufficient. The actual AI World Run must complete.

## 4. Final decision

After all three proofs succeed:

1. re-fetch the current default-branch HEAD and ensure no unverified code-bearing
   change has landed since the latest green release tree;
2. update `docs/audits/acceptance-2026-08-18.md` with the real Run/action evidence;
3. change product acceptance to **24/24 PASS**;
4. mark production activation **READY** only if the same deployed environment
   passed the public preflight and all three owner/environment proofs.

If any proof fails, keep the corresponding gate open, preserve its exact error
and evidence, fix the root cause, and rerun that proof. Never convert a fixture,
mock, deterministic verifier or visible Chat response into live acceptance.
