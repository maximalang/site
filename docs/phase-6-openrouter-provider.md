# Phase 6 — OpenRouter Provider Integration

Status: implementation in progress.

Base after Phase 5 merge: `5f7515d2447d8a4c082a413d4c30faa76ad20db4`.

## Invariants

- Reuse the existing `OPENROUTER` provider kind and canonical Provider → Account → Canonical Model → Model Route architecture.
- Execute through the existing LiteLLM projection/gateway and durable model execution stack; do not add a parallel OpenRouter gateway.
- Store provider API keys only through the existing authenticated provider-credential API and encrypted secret store.
- Preserve canonical OpenRouter remote model slugs (`provider/model`) in route data; derive transport-specific LiteLLM identifiers only at the resolver/projection boundary.
- Keep OpenRouter on its canonical HTTPS API origin for the initial integration.
- Standard CI uses mocked/local traffic only and requires no live OpenRouter key.
- No deployment; Phase 6 PR remains Draft until review.

Implementation details and verified protocol/LiteLLM mapping will be recorded here as the phase lands.
