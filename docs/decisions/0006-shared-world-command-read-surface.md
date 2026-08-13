# ADR 0006: Shared World and Command read surface

- Status: Accepted for Phase 1
- Date: 2026-08-13

## Context

The first user-facing shell must prove that World and Command are two views of
one Agent domain, not two products that happen to show similar data. The World
renderer must also remain a projection: it cannot own Agent state, connect to a
runtime, generate dialogue or make decorative model calls.

The OpenClaw read adapter is deliberately server-only and does not yet have the
live integration evidence required for production. A browser shell still needs
truthful loading, invalid-response and unavailable behavior while that binding
is absent.

## Decision

Use one Next.js App Router application and one read-only `/api/world` endpoint.

- The endpoint returns only the strict, bounded `WorldReadModel` contract and
  disables response caching.
- The browser validates every response against the canonical schema before
  rendering it.
- World and Command derive their views from that same validated object and its
  replay cursor. Agent selection is one shared UI state resolved against the
  canonical Agent projection.
- World uses the narrow MIT Canvas port recorded in ADR 0002. The port owns only
  deterministic layout, drawing and hit testing.
- The browser never imports or connects to a runtime client and receives no
  runtime session IDs, gateway credentials or Agent instructions.
- With no authoritative provider, the server returns a truthful `UNAVAILABLE`
  empty projection. The contract fixture is allowed only outside production and
  is visibly labelled as non-live in the UI.

## Alternatives considered

### Separate World and Command APIs or stores

Rejected. Independent fetch and state paths would permit cursor, identity and
task drift and would undermine the central acceptance invariant.

### Direct World WebSocket connection

Rejected. It would bypass the server-side adapter, credential boundary,
canonical binding and future persisted event ledger.

### Full Agent Town application fork

Rejected. Its in-memory stores, random idle simulation and generated chatter
conflict with the product domain. Only the renderer/interaction kernel is
reused.

### Production demo fixture

Rejected. A polished synthetic fleet would misrepresent runtime availability.
Production fails closed until a real provider is integrated and verified.

## Consequences

- Slice 3 proves one browser/API boundary and responsive interaction, not live
  OpenClaw compatibility, persistence, authentication or deployment readiness.
- Slice 4 must add conversation selection and send intent through this same
  Agent identity and API boundary; it must not introduce a World-only channel.
- Slice 6 must bind the endpoint to the persisted/live projection and run the
  isolated OpenClaw and self-hosted restart evidence before production claims.
- Any future additional renderer remains a replaceable consumer of the same
  read model and cannot become an authority.

Official Next.js references:

- <https://nextjs.org/docs/app/getting-started/route-handlers>
- <https://nextjs.org/docs/app/guides/testing/playwright>
- <https://nextjs.org/docs/app/guides/self-hosting>
