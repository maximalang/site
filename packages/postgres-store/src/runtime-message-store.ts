import {
  AgentConversationMessageSchema,
  AgentIdSchema,
  BindingIdSchema,
  ConversationIdSchema,
  MessageIdSchema,
  OpaqueExternalIdSchema,
  SessionIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";

const ReceivedMessageSchema = z.strictObject({
  externalMessageId: OpaqueExternalIdSchema,
  content: AgentConversationMessageSchema.shape.content,
  createdAt: TimestampSchema,
});

const ReceiveHistorySchema = z.strictObject({
  conversationId: ConversationIdSchema,
  sessionId: SessionIdSchema,
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  externalSessionKey: OpaqueExternalIdSchema,
  messages: z.array(ReceivedMessageSchema).max(200),
});

type SessionRow = QueryResultRow & {
  id: string;
  conversation_id: string;
  agent_id: string;
  binding_id: string;
  external_session_ref: string;
};

type MessageRow = QueryResultRow & {
  id: string;
  conversation_id: string;
  session_id: string;
  agent_id: string;
  content: string;
  created_at: Date | string;
};

type MessageIdFactory = () => string;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function one<Row extends QueryResultRow>(
  rows: Row[],
  description: string,
): Promise<Row | undefined> {
  if (rows.length > 1) throw new Error(`${description} returned an invalid cardinality`);
  return rows[0];
}

export type ReceiveOpenClawHistoryInput = z.input<typeof ReceiveHistorySchema>;

export class PostgresRuntimeMessageStore {
  private readonly messageId: MessageIdFactory;

  constructor(
    private readonly pool: TransactionPool,
    options: { messageId?: MessageIdFactory } = {},
  ) {
    this.messageId =
      options.messageId ??
      (() => {
        throw new Error("A production runtime Message identity generator is required");
      });
  }

  async receiveOpenClawHistory(input: ReceiveOpenClawHistoryInput): Promise<number> {
    const history = ReceiveHistorySchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const session = await one(
        (
          await client.query<SessionRow>(
            `SELECT s.id, s.conversation_id, s.agent_id, s.binding_id, s.external_session_ref
               FROM agent_world.conversation_sessions s
               JOIN agent_world.runtime_bindings b
                 ON b.id = s.binding_id
                AND b.agent_id = s.agent_id
                AND b.adapter_kind = s.adapter_kind
              WHERE s.id = $1
                AND s.conversation_id = $2
                AND s.agent_id = $3
                AND s.binding_id = $4
                AND s.adapter_kind = 'OPENCLAW'
                AND s.external_session_ref = $5
                AND s.ended_at IS NULL
                AND b.is_enabled = true
              FOR SHARE OF s, b`,
            [
              history.sessionId,
              history.conversationId,
              history.agentId,
              history.bindingId,
              history.externalSessionKey,
            ],
          )
        ).rows,
        "Runtime conversation session",
      );
      if (!session) throw new Error("OpenClaw history does not match an active canonical session");

      let inserted = 0;
      for (const message of history.messages) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `OPENCLAW:${history.bindingId}:${message.externalMessageId}`,
        ]);
        const existing = await this.findExisting(
          client,
          history.bindingId,
          message.externalMessageId,
        );
        if (existing) {
          if (
            existing.conversation_id !== history.conversationId ||
            existing.session_id !== history.sessionId ||
            existing.agent_id !== history.agentId ||
            existing.content !== message.content ||
            iso(existing.created_at) !== message.createdAt
          ) {
            throw new Error("OpenClaw message identity conflicts with canonical history");
          }
          continue;
        }
        const id = MessageIdSchema.parse(this.messageId());
        await client.query(
          `INSERT INTO agent_world.conversation_messages
             (id, conversation_id, session_id, agent_id, author, content, delivery,
              created_at, source_kind, adapter_kind, binding_id, external_message_id)
           VALUES ($1, $2, $3, $4, 'AGENT', $5, 'RECEIVED', $6,
                   'RUNTIME', 'OPENCLAW', $7, $8)`,
          [
            id,
            history.conversationId,
            history.sessionId,
            history.agentId,
            message.content,
            message.createdAt,
            history.bindingId,
            message.externalMessageId,
          ],
        );
        AgentConversationMessageSchema.parse({
          schemaVersion: 1,
          id,
          conversationId: history.conversationId,
          sessionId: history.sessionId,
          agentId: history.agentId,
          author: "AGENT",
          content: message.content,
          delivery: "RECEIVED",
          createdAt: message.createdAt,
          source: {
            kind: "RUNTIME",
            adapterKind: "OPENCLAW",
            bindingId: history.bindingId,
            externalMessageId: message.externalMessageId,
          },
        });
        inserted += 1;
      }
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the inbox failure; the pool will discard a broken client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async findExisting(
    client: TransactionClient,
    bindingId: string,
    externalMessageId: string,
  ): Promise<MessageRow | undefined> {
    return one(
      (
        await client.query<MessageRow>(
          `SELECT id, conversation_id, session_id, agent_id, content, created_at
             FROM agent_world.conversation_messages
            WHERE adapter_kind = 'OPENCLAW'
              AND binding_id = $1
              AND external_message_id = $2
            FOR UPDATE`,
          [bindingId, externalMessageId],
        )
      ).rows,
      "Runtime message identity",
    );
  }
}
