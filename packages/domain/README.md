# `@agent-world/domain`

Versioned domain and event wire contracts for the Agent Operating Environment.

## Guarantees

- `AgentId`, `AccountId`, `SessionId`, `RouteId` and other identities have
  distinct runtime prefixes and TypeScript brands.
- Zod strict objects reject unknown fields at trust boundaries.
- `RuntimeBinding` maps a canonical Agent to an opaque external runtime ID
  without treating either value as the other.
- `WorldEvent` is a closed discriminated union sourced from a real runtime event
  or a canonical domain command.
- Projection cursors cannot advance without the exact last Event identity.

## Usage

```ts
import { AgentSchema, WorldEventSchema } from "@agent-world/domain";

const agent = AgentSchema.parse(untrustedAgentPayload);
const event = WorldEventSchema.parse(untrustedRuntimeEvent);
```

Use `.safeParse()` where callers need structured validation results instead of
exceptions. Never cast untrusted strings directly to branded ID types.

Durable aggregate and event envelopes include `schemaVersion: 1`. Changes must
be additive within the current version; incompatible changes need a new ADR and
an explicit migration path.
