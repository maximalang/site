# ADR 0008: PostgreSQL-backed single-owner sessions

- Status: accepted for Phase 1 composition
- Date: 2026-08-13

## Context

The product is single-user, but its browser controls privileged runtime and
infrastructure operations. A gateway token, owner bearer secret or password in
browser storage would make an XSS or copied profile equivalent to permanent
control-plane access. Stateless browser sessions would also make immediate
revocation and restart-safe login throttling harder to reconcile with the
canonical PostgreSQL boundary.

## Decision

- The owner password is configured only as a fixed-parameter Node scrypt hash.
  The application never stores or logs the plaintext password.
- A successful login creates a random 256-bit opaque token. Only its SHA-256
  digest and bounded lifetime are persisted in PostgreSQL.
- Production uses a `__Host-` cookie with `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/`, an explicit expiry and high priority.
- PostgreSQL owns session revocation and a global single-owner login throttle.
  Six concurrent attempts prove that only five claims enter one 15-minute
  window; the next is blocked until reset or expiry.
- A separate 256-bit server secret derives a per-session CSRF token using HMAC.
  The raw session token remains HttpOnly. Browser mutations require the derived
  token, an exact same-origin `Origin`, and a compatible Fetch Metadata value.
- Authentication failures are bounded HTTP codes. Database, password-hash and
  cryptographic configuration details are never reflected.

## Rejected alternatives

### Browser-stored owner or OpenClaw bearer token

Rejected. It violates secret separation and turns local storage into the
control-plane credential authority.

### Stateless owner JWT as the only session authority

Rejected for the initial deployment. Immediate revocation, persisted throttle
state and one PostgreSQL source of truth are more valuable than avoiding one
indexed session lookup.

### "Local network means no login"

Rejected. Private-by-default binding and Tailscale reduce exposure but do not
replace authorization, CSRF protection or auditable revocation.

## Consequences and evidence boundary

The migration and store are verified against a disposable pinned PostgreSQL
18.3 container. Unit tests cover hashing, cookie parsing, CSRF, origin checks,
redaction and bounded HTTP behavior. This ADR does not yet prove the production
reverse proxy, HTTPS, login UI, backup/restore or secret provisioning; those
remain deployment acceptance gates.
