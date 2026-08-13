# Phase 3 Plan: Model Gateway and Local Models

## Outcome

Route model requests through one pinned LiteLLM core service without making
LiteLLM a second source of truth. Canonical Providers, Accounts, Models and
ModelRoutes remain PostgreSQL-owned. Product code depends only on a versioned
`ModelGateway` contract so LiteLLM can later be replaced by Bifrost rather than
run beside it.

## Fixed boundaries

- LiteLLM `v1.96.2` core is the only model gateway in the first deployment.
- Only its OpenAI-compatible API and documented configuration are consumed.
  The product does not expose or embed the LiteLLM dashboard or enterprise
  modules.
- Every request names one canonical ModelRoute. Provider-specific model names,
  credentials and endpoints are resolved behind the adapter.
- PostgreSQL is authoritative. Generated LiteLLM configuration is a projection
  and is safe to recreate.
- Secrets are written through a dedicated `SecretStore`; plaintext is never
  returned by reads, persisted in domain tables, logged or sent to the browser.
- Local Ollama and LM Studio routes use the same gateway contract and routing
  policy as paid API routes.
- Requests and responses are schema-validated, bounded and correlated. Unknown
  fields, routes, tools and malformed usage fail closed.

## Slice 1: ModelGateway contract

Define versioned schemas for chat requests, normalized results, usage, health
and typed failures. Add an adapter-neutral interface and contract tests that
prove strict parsing, route identity, token bounds, timeout/cancellation and
secret-free errors.

- [x] Contract has no LiteLLM-specific or provider-specific public fields.
- [x] One request selects exactly one ModelRoute.
- [x] Usage retains input, output, cached and reasoning token provenance.
- [x] Tool calls are typed and bounded; unsupported multimodal inputs reject.
- [x] Timeout, upstream auth, rate-limit and unavailable failures normalize
      without leaking response bodies or credentials.

## Slice 2: LiteLLM adapter and live contract

Implement the contract over the documented OpenAI-compatible
`/chat/completions` surface. Run the digest-pinned upstream image against a
deterministic loopback OpenAI-compatible provider and verify authentication,
model projection, content, usage, correlation and failure normalization.

- [x] Exact LiteLLM release and image digest are recorded and verified.
- [x] Gateway URL is private/internal and credentials are injected, not stored
      in checked-in configuration.
- [x] Live verifier exercises the real image, not a mocked LiteLLM client.
- [x] Health/readiness is proven independently of one provider completion.

## Slice 3: SecretStore and provider-key command

Add an encrypted-at-rest PostgreSQL secret adapter using a deployment master
key outside PostgreSQL. The owner-authenticated write command creates or
rotates a provider credential and stores only an opaque `secret-store:`
reference on Account.

- [x] AES-256-GCM uses a fresh nonce and authenticated metadata per version.
- [x] Reads are adapter-only and never available through read models.
- [x] Rotation is atomic and auditable without secret values.
- [x] API responses, receipts, logs, browser storage and backups contain no
      plaintext provider key.

## Slice 4: PostgreSQL projection and routing

Resolve enabled route/provider/account records transactionally, render a
deterministic LiteLLM projection and select only policy-eligible routes.

- [x] Disabled, unavailable, mismatched and unconfigured routes fail closed.
- [x] Canonical Model cards remain unique while several ModelRoutes may target
      the same physical model.
- [ ] Reconciliation is deterministic and does not make LiteLLM authoritative.
- [x] Local routes require explicit allowlisted private endpoints and cannot be
      used as arbitrary SSRF targets.

## Slice 5: Product flow and deployment

Add the single-owner provider/key flow, route health/status and actual execution
evidence to Command without exposing third-party dashboards. Extend the
hardened Compose core with the private, bounded gateway service.

- [x] Owner can add or rotate an API provider/key once through the product.
- [x] No plaintext key is rendered after submission.
- [ ] A real API or local-model run shows Account/API/Model/Mode provenance.
- [x] LiteLLM has no host port, runs with bounded resources and participates in
      readiness without weakening the existing web/PostgreSQL gates.
- [ ] Backup/restore and restart preserve authoritative routes and secret
      ciphertext, and reconciliation restores the gateway projection.

## Verification gate

- Unit and type tests pass for every contract and adapter failure class.
- Disposable PostgreSQL verification proves secret isolation, rotation and
  route eligibility.
- The digest-pinned LiteLLM live verifier proves a completion and degraded
  upstream behavior through the real proxy.
- Browser tests prove the owner provider/key workflow, unique model display and
  execution provenance at desktop and authenticated mobile sizes.
- Compose verification proves private networking, non-root/read-only operation
  where supported by the pinned image, bounded resources, readiness degradation
  and recovery.
