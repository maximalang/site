# Phase 7 — OpenRouter Provider Integration

Status: implementation and verification in progress.

Corrective World Phase 6 merged as `57f98f7c2112f81f338c158dcd5481e04f184384`; this Phase 7 branch is rebased onto that exact base. The historical branch name `codex/phase-6-openrouter-provider` predates the corrective World Phase 6 and is intentionally retained.

## Canonical architecture

OpenRouter uses the existing path only:

Provider → Account → Canonical Model → Model Route → route resolver → LiteLLM projection → LiteLLM gateway → durable execution.

There is no OpenRouter-specific gateway, dispatcher, browser-side provider request, runtime, or secret store.

## Protocol and model identity

- Provider kind: `OPENROUTER`.
- Canonical API base: `https://openrouter.ai/api/v1`.
- Chat endpoint: `POST /chat/completions` under that base.
- Provider authentication: `Authorization: Bearer <API_KEY>`.
- Canonical `remoteModelId`: the upstream OpenRouter slug in `provider/model` form, for example `openai/gpt-5`.
- The canonical database value is never prefixed with `openrouter/`.
- At the resolver/projection boundary only, LiteLLM receives `openrouter/<provider>/<model>`.
- The resolver ignores any configured OpenRouter provider `base_url` and fixes the projected `apiBase` to the canonical OpenRouter origin.

The repository LiteLLM verifier uses the exact pinned image:

`ghcr.io/berriai/litellm@sha256:154e23bb5f31b1f10e16392a8ef299bd2cde08de3a64a6849002cfcc25ce3c63`

This pin corresponds to LiteLLM v1.96.2. The disposable OpenRouter verifier projects `openrouter/anthropic/test-model` into that container and confirms that LiteLLM calls a local fake OpenRouter-compatible `/api/v1/chat/completions` endpoint with model `anthropic/test-model` and the projected provider credential. No real OpenRouter key or credits are required.

## Credential architecture

The owner flow is browser → authenticated same-origin server route → encrypted secret store → `credentialRef` → server runtime → LiteLLM.

Provider keys use secret purpose `PROVIDER_API_KEY`. The Hub read model, HTML, post-save browser state, route-check responses, logs, errors, screenshots, URLs, and snapshots must never contain stored plaintext credentials.

## Hub owner flow

OpenRouter remains inside the existing Hub:

OpenRouter provider → API account → securely save key → canonical model → `provider/model` route → route check → execution preferences → existing runtime execution.

The route setup validates obvious malformed OpenRouter model IDs in the client for immediate feedback and again at the server resolver boundary before projection.

## Route check and failures

Route check uses the canonical route resolver and the same LiteLLM gateway used by durable execution. It does not perform a direct OpenRouter HTTP probe.

The gateway normalizes provider/gateway failures including authentication failure, rate limit, timeout, upstream unavailable, and malformed upstream response. The HTTP route exposes only a bounded generic failure code and does not reflect upstream error text or credentials.

## Verification policy

Standard CI does not require a live OpenRouter API key. The pinned LiteLLM contract test is entirely disposable and loopback-local. A real OpenRouter smoke is optional only when an explicit development key is already available.

Targeted Hub visual evidence is captured at 1440×1000 and 390×844 for registry, OpenRouter setup, routing, and route-check state. World Phase 6 is not redesigned or modified.

No deployment. PR #60 remains Draft and must not be merged as part of Phase 7 verification.