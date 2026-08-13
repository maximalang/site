# ADR 0009: Pre-request Node runtime composition

- Status: accepted for the Phase 1 server shell
- Date: 2026-08-13

## Context

HTTP requests must not lazily open privileged OpenClaw sockets or race database
migrations. World, conversations and authentication also need one process-wide
composition root, while an unavailable optional adapter must not take the
PostgreSQL/auth core offline.

## Decision

- Next.js `instrumentation.register()` dynamically imports Node-only startup
  code when `NEXT_RUNTIME=nodejs`.
- Startup validates the database transport policy, opens one bounded pool,
  pings PostgreSQL and applies checksum-locked migrations before publishing the
  application runtime registry.
- Concurrent startup is coalesced. Routes can only read an already-published
  runtime and return bounded unavailable/unauthorized responses otherwise.
- PostgreSQL loads canonical Agents separately from enabled OpenClaw bindings.
  Account, Binding and Session identities never become Agent identities.
- Read and write OpenClaw clients remain physically separate and request exact
  `operator.read` and `operator.write` authority. Delivery resolution exposes
  the write adapter only after its exact-authority handshake is `READY`.
- Optional OpenClaw absence or constructor/config rejection leaves the core
  available. The World read model remains explicitly `UNAVAILABLE`; it does not
  fabricate activity.
- Once a validated runtime snapshot arrives, a browser-safe LIVE projection
  maps only canonical Agent IDs and statuses. Runtime locators are omitted.
- World, conversation and auth APIs all require the same PostgreSQL-backed
  owner session. Mutations additionally require HMAC-derived CSRF and an
  Origin-to-Host check compatible with an overwriting reverse proxy.

## Packaging and verification

The monorepo root is the standalone trace root and the SQL migration allowlist
is explicitly included. A disposable verifier starts the traced `server.js`
against pinned PostgreSQL 18.3 and proves migrations, login, CSRF session
refresh, authenticated World/conversation access, logout, persisted revocation,
restart and isolation from an invalid optional OpenClaw adapter.

## Evidence boundary

This composition does not yet prove a live OpenClaw handshake. The current LIVE
World cursor is process-local and therefore is not restart/replay evidence.
Canonical persisted runtime events, task assignment, the login/chat UI, HTTPS
reverse proxy and production backup/restore remain required Phase 1 gates.
