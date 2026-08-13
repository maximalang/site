import {
  ConversationIdSchema,
  type ConversationMessage,
  ConversationMessageSchema,
} from "@agent-world/domain";
import {
  buildConversationReadModel,
  ConversationMessageCursorSchema,
  type ConversationReadModel,
  MAX_CONVERSATION_PAGE_MESSAGES,
} from "@agent-world/read-model";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const ReadInputSchema = z.strictObject({
  conversationId: ConversationIdSchema,
  olderThan: ConversationMessageCursorSchema.optional(),
  limit: z.number().int().min(1).max(MAX_CONVERSATION_PAGE_MESSAGES).default(100),
});
export type ConversationReadInput = z.input<typeof ReadInputSchema>;

type HeaderRow = {
  conversation_id: string;
  project_id: string;
  conversation_title: string | null;
  conversation_created_at: Date | string;
  agent_id: string;
  agent_slug: string;
  agent_display_name: string;
  agent_role: string;
  agent_instructions: string;
  agent_is_enabled: boolean;
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
  source_kind: string;
  command_id: string | null;
  adapter_kind: string | null;
  binding_id: string | null;
  external_message_id: string | null;
};

const HEADER_SQL = `
SELECT c.id AS conversation_id, c.project_id,
       c.title AS conversation_title, c.created_at AS conversation_created_at,
       a.id AS agent_id, a.slug AS agent_slug,
       a.display_name AS agent_display_name, a.role AS agent_role,
       a.instructions AS agent_instructions, a.is_enabled AS agent_is_enabled
  FROM agent_world.conversations c
  JOIN agent_world.agents a ON a.id = c.agent_id
 WHERE c.id = $1`;

const MESSAGE_COLUMNS = `
SELECT id, conversation_id, session_id, agent_id, author, content, delivery,
       created_at, source_kind, command_id, adapter_kind, binding_id,
       external_message_id
  FROM agent_world.conversation_messages`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseMessage(row: MessageRow): ConversationMessage {
  return ConversationMessageSchema.parse({
    schemaVersion: 1,
    id: row.id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    author: row.author,
    content: row.content,
    delivery: row.delivery,
    createdAt: iso(row.created_at),
    source:
      row.source_kind === "DOMAIN"
        ? { kind: "DOMAIN", actor: "OWNER", commandId: row.command_id }
        : {
            kind: "RUNTIME",
            adapterKind: row.adapter_kind,
            bindingId: row.binding_id,
            externalMessageId: row.external_message_id,
          },
  });
}

export type PostgresConversationReaderOptions = {
  now?: () => Date;
};

export class PostgresConversationReader {
  private readonly now: () => Date;

  constructor(
    private readonly pool: TransactionPool,
    options: PostgresConversationReaderOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async read(input: ConversationReadInput): Promise<ConversationReadModel | undefined> {
    const parsed = ReadInputSchema.parse(input);
    const client = await this.pool.connect();
    try {
      const headerResult = await client.query<HeaderRow>(HEADER_SQL, [parsed.conversationId]);
      if (headerResult.rows.length === 0) {
        return undefined;
      }
      if (headerResult.rows.length !== 1) {
        throw new Error("Canonical Conversation query returned more than one row");
      }
      const header = headerResult.rows[0];
      if (!header) {
        return undefined;
      }
      const messageLimit = parsed.limit + 1;
      const messageResult = parsed.olderThan
        ? await client.query<MessageRow>(
            `${MESSAGE_COLUMNS}
              WHERE conversation_id = $1
                AND (created_at, id) < ($2::timestamptz, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [
              parsed.conversationId,
              parsed.olderThan.createdAt,
              parsed.olderThan.messageId,
              messageLimit,
            ],
          )
        : await client.query<MessageRow>(
            `${MESSAGE_COLUMNS}
              WHERE conversation_id = $1
              ORDER BY created_at DESC, id DESC
              LIMIT $2`,
            [parsed.conversationId, messageLimit],
          );
      const hasOlderMessages = messageResult.rows.length > parsed.limit;
      const rows = messageResult.rows.slice(0, parsed.limit);

      return buildConversationReadModel({
        generatedAt: this.now().toISOString(),
        conversation: {
          schemaVersion: 1,
          id: header.conversation_id,
          agentId: header.agent_id,
          projectId: header.project_id,
          ...(header.conversation_title === null ? {} : { title: header.conversation_title }),
          createdAt: iso(header.conversation_created_at),
        },
        agent: {
          schemaVersion: 1,
          id: header.agent_id,
          slug: header.agent_slug,
          displayName: header.agent_display_name,
          role: header.agent_role,
          instructions: header.agent_instructions,
          isEnabled: header.agent_is_enabled,
        },
        messages: rows.map(parseMessage),
        hasOlderMessages,
      });
    } finally {
      client.release();
    }
  }
}
