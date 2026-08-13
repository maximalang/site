import type {
  ConversationCommandStore,
  MarkDispatchedInput,
  MarkFailedInput,
  PrepareSendInput,
  PrepareSendResult,
} from "@agent-world/conversation-service";
import {
  ConversationMessageSchema,
  ConversationSchema,
  ConversationSessionSchema,
  type OwnerConversationMessage,
  RuntimeBindingSchema,
  type SendMessageIntent,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";

export type TransactionQueryResult<Row extends QueryResultRow = QueryResultRow> = {
  rows: Row[];
};

export interface TransactionClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<TransactionQueryResult<Row>>;
  release(): void;
}

export interface TransactionPool {
  connect(): Promise<TransactionClient>;
}

type ConversationRow = {
  id: string;
  agent_id: string;
  project_id: string;
  title: string | null;
  created_at: Date | string;
};

type SessionBindingRow = {
  id: string;
  conversation_id: string;
  agent_id: string;
  binding_id: string;
  adapter_kind: string;
  external_session_ref: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  route_id: string;
  external_agent_id: string;
  binding_is_enabled: boolean;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  session_id: string;
  agent_id: string;
  author: string;
  content: string;
  delivery: string;
  created_at: Date | string;
  command_id: string | null;
};

const FIND_MESSAGE_SQL = `
SELECT id, conversation_id, session_id, agent_id, author, content, delivery,
       created_at, command_id
  FROM agent_world.conversation_messages
 WHERE idempotency_key = $1 OR id = $2
 FOR UPDATE`;

const FIND_CONVERSATION_SQL = `
SELECT id, agent_id, project_id, title, created_at
  FROM agent_world.conversations
 WHERE id = $1
 FOR SHARE`;

const FIND_ACTIVE_SESSION_SQL = `
SELECT s.id, s.conversation_id, s.agent_id, s.binding_id, s.adapter_kind,
       s.external_session_ref, s.started_at, s.ended_at, b.route_id,
       b.external_agent_id, b.is_enabled AS binding_is_enabled
  FROM agent_world.conversation_sessions s
  JOIN agent_world.runtime_bindings b
    ON b.id = s.binding_id
   AND b.agent_id = s.agent_id
   AND b.adapter_kind = s.adapter_kind
 WHERE s.conversation_id = $1
   AND s.ended_at IS NULL
   AND b.is_enabled = true
 FOR SHARE OF s, b`;

const FIND_ACTIVE_SESSION_BY_ID_SQL = `
SELECT s.id, s.conversation_id, s.agent_id, s.binding_id, s.adapter_kind,
       s.external_session_ref, s.started_at, s.ended_at, b.route_id,
       b.external_agent_id, b.is_enabled AS binding_is_enabled
  FROM agent_world.conversation_sessions s
  JOIN agent_world.runtime_bindings b
    ON b.id = s.binding_id
   AND b.agent_id = s.agent_id
   AND b.adapter_kind = s.adapter_kind
 WHERE s.id = $1
   AND s.ended_at IS NULL
   AND b.is_enabled = true
 FOR SHARE OF s, b`;

const INSERT_MESSAGE_SQL = `
INSERT INTO agent_world.conversation_messages (
  id, conversation_id, session_id, agent_id, author, content, delivery,
  created_at, source_kind, command_id, idempotency_key, accepted_at
)
VALUES ($1, $2, $3, $4, 'OWNER', $5, 'ACCEPTED', $6, 'DOMAIN', $7, $8, $9)`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseConversation(row: ConversationRow) {
  return ConversationSchema.parse({
    schemaVersion: 1,
    id: row.id,
    agentId: row.agent_id,
    projectId: row.project_id,
    ...(row.title === null ? {} : { title: row.title }),
    createdAt: iso(row.created_at),
  });
}

function parseSession(row: SessionBindingRow) {
  return ConversationSessionSchema.parse({
    schemaVersion: 1,
    id: row.id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    bindingId: row.binding_id,
    adapterKind: row.adapter_kind,
    externalSessionRef: row.external_session_ref,
    startedAt: iso(row.started_at),
    ...(row.ended_at === null ? {} : { endedAt: iso(row.ended_at) }),
  });
}

function parseBinding(row: SessionBindingRow) {
  return RuntimeBindingSchema.parse({
    schemaVersion: 1,
    id: row.binding_id,
    agentId: row.agent_id,
    routeId: row.route_id,
    adapterKind: row.adapter_kind,
    externalAgentId: row.external_agent_id,
    isEnabled: row.binding_is_enabled,
  });
}

function parseMessage(row: MessageRow): OwnerConversationMessage {
  const parsed = ConversationMessageSchema.parse({
    schemaVersion: 1,
    id: row.id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    author: row.author,
    content: row.content,
    delivery: row.delivery,
    createdAt: iso(row.created_at),
    source: { kind: "DOMAIN", actor: "OWNER", commandId: row.command_id },
  });
  if (parsed.author !== "OWNER") {
    throw new Error("Expected an owner conversation message");
  }
  return parsed;
}

function isSameIntent(row: MessageRow, intent: SendMessageIntent): boolean {
  return (
    row.id === intent.id &&
    row.conversation_id === intent.conversationId &&
    row.agent_id === intent.agentId &&
    row.content === intent.content &&
    row.command_id === intent.idempotencyKey
  );
}

async function firstRow<Row extends QueryResultRow>(
  result: TransactionQueryResult<Row>,
): Promise<Row | undefined> {
  if (result.rows.length > 1) {
    throw new Error("Canonical query returned more than one row");
  }
  return result.rows[0];
}

export class PostgresConversationStore implements ConversationCommandStore {
  constructor(private readonly pool: TransactionPool) {}

  async prepareSend(input: PrepareSendInput): Promise<PrepareSendResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const lockKey of [input.intent.idempotencyKey, input.intent.id].toSorted()) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      }

      const existing = await firstRow(
        await client.query<MessageRow>(FIND_MESSAGE_SQL, [
          input.intent.idempotencyKey,
          input.intent.id,
        ]),
      );
      if (existing) {
        if (!isSameIntent(existing, input.intent)) {
          await client.query("COMMIT");
          return { kind: "REJECTED", code: "IDEMPOTENCY_CONFLICT" };
        }
        const message = parseMessage(existing);
        if (message.delivery === "DISPATCHED") {
          await client.query("COMMIT");
          return { kind: "REPLAY", message };
        }
        const resumed = await this.loadReady(client, input.intent, message);
        await client.query("COMMIT");
        return resumed;
      }

      const conversationRow = await firstRow(
        await client.query<ConversationRow>(FIND_CONVERSATION_SQL, [input.intent.conversationId]),
      );
      if (!conversationRow) {
        await client.query("COMMIT");
        return { kind: "REJECTED", code: "CONVERSATION_NOT_FOUND" };
      }
      const conversation = parseConversation(conversationRow);
      if (conversation.agentId !== input.intent.agentId) {
        await client.query("COMMIT");
        return { kind: "REJECTED", code: "AGENT_MISMATCH" };
      }
      const sessionRow = await firstRow(
        await client.query<SessionBindingRow>(FIND_ACTIVE_SESSION_SQL, [
          input.intent.conversationId,
        ]),
      );
      if (!sessionRow) {
        await client.query("COMMIT");
        return { kind: "REJECTED", code: "NO_ACTIVE_SESSION" };
      }
      const session = parseSession(sessionRow);
      const binding = parseBinding(sessionRow);
      if (!binding.isEnabled) {
        await client.query("COMMIT");
        return { kind: "REJECTED", code: "NO_ACTIVE_SESSION" };
      }

      await client.query(INSERT_MESSAGE_SQL, [
        input.intent.id,
        input.intent.conversationId,
        session.id,
        input.intent.agentId,
        input.intent.content,
        input.intent.createdAt,
        input.intent.idempotencyKey,
        input.intent.idempotencyKey,
        input.acceptedAt,
      ]);
      const message = parseMessage({
        id: input.intent.id,
        conversation_id: input.intent.conversationId,
        session_id: session.id,
        agent_id: input.intent.agentId,
        author: "OWNER",
        content: input.intent.content,
        delivery: "ACCEPTED",
        created_at: input.intent.createdAt,
        command_id: input.intent.idempotencyKey,
      });
      await client.query("COMMIT");
      return { kind: "READY", conversation, session, binding, message };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error; the pool discards broken clients.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async markDispatched(input: MarkDispatchedInput): Promise<OwnerConversationMessage> {
    const result = await this.poolQuery<MessageRow>(
      `UPDATE agent_world.conversation_messages
          SET delivery = 'DISPATCHED', dispatched_at = $3,
              external_request_id = $4, failed_at = NULL, failure_code = NULL
        WHERE id = $1 AND session_id = $2 AND delivery IN ('ACCEPTED', 'FAILED')
        RETURNING id, conversation_id, session_id, agent_id, author, content,
                  delivery, created_at, command_id`,
      [
        input.messageId,
        input.sessionId,
        input.dispatchedAt,
        input.receipt.externalRequestId ?? null,
      ],
    );
    return this.requireUpdatedMessage(result);
  }

  async markFailed(input: MarkFailedInput): Promise<OwnerConversationMessage> {
    const result = await this.poolQuery<MessageRow>(
      `UPDATE agent_world.conversation_messages
          SET delivery = 'FAILED', failed_at = $3, failure_code = $4
        WHERE id = $1 AND session_id = $2 AND delivery IN ('ACCEPTED', 'FAILED')
        RETURNING id, conversation_id, session_id, agent_id, author, content,
                  delivery, created_at, command_id`,
      [input.messageId, input.sessionId, input.failedAt, input.failureCode],
    );
    return this.requireUpdatedMessage(result);
  }

  private async loadReady(
    client: TransactionClient,
    intent: SendMessageIntent,
    message: OwnerConversationMessage,
  ): Promise<PrepareSendResult> {
    const conversationRow = await firstRow(
      await client.query<ConversationRow>(FIND_CONVERSATION_SQL, [intent.conversationId]),
    );
    const sessionRow = await firstRow(
      await client.query<SessionBindingRow>(FIND_ACTIVE_SESSION_BY_ID_SQL, [message.sessionId]),
    );
    if (!conversationRow || !sessionRow) {
      return { kind: "REJECTED", code: "NO_ACTIVE_SESSION" };
    }
    return {
      kind: "READY",
      conversation: parseConversation(conversationRow),
      session: parseSession(sessionRow),
      binding: parseBinding(sessionRow),
      message,
    };
  }

  private async poolQuery<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<TransactionQueryResult<Row>> {
    const client = await this.pool.connect();
    try {
      return await client.query<Row>(text, values);
    } finally {
      client.release();
    }
  }

  private async requireUpdatedMessage(
    result: TransactionQueryResult<MessageRow>,
  ): Promise<OwnerConversationMessage> {
    const row = await firstRow(result);
    if (!row) {
      throw new Error("Conversation message delivery transition was rejected");
    }
    return parseMessage(row);
  }
}
