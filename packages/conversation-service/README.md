# `@agent-world/conversation-service`

Fail-closed application boundary for accepting and delivering canonical owner
messages without exposing runtime routing fields to the API intent.

## Persistence contract

Production implementations of `ConversationCommandStore` must use PostgreSQL
and make `prepareSend` one transaction. That transaction must:

1. claim the idempotency key together with all immutable intent fields;
2. verify that the Conversation belongs to the requested Agent;
3. select and persist one active `ConversationSession` with an enabled,
   same-Agent `RuntimeBinding`;
4. create the owner message before returning `READY`.

A completed exact duplicate returns `REPLAY`. Reuse of a key with different
immutable input returns `IDEMPOTENCY_CONFLICT`. Store results are validated
again by the service before any runtime call.

## Delivery contract

Adapters receive only the stable canonical IDs, bounded content and the
persistence-selected runtime locator. They must deduplicate retries by the
provided `idempotencyKey`. This makes a retry safe if a process exits after the
runtime accepted a message but before `markDispatched` committed.

Adapter and database errors are mapped to bounded error codes; raw provider
responses, credentials and message content are never included in thrown
errors.
