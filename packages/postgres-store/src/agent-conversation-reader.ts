import { AgentIdSchema } from "@agent-world/domain";
import { type AgentConversationList, AgentConversationListSchema } from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type AgentRow = QueryResultRow & { id: string; display_name: string };
type ConversationRow = QueryResultRow & {
  id: string;
  project_id: string;
  title: string | null;
  created_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class PostgresAgentConversationReader {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(agentIdInput: unknown): Promise<AgentConversationList | undefined> {
    const agentId = AgentIdSchema.parse(agentIdInput);
    const client = await this.pool.connect();
    try {
      const agentResult = await client.query<AgentRow>(
        `SELECT id, display_name
           FROM agent_world.agents
          WHERE id = $1`,
        [agentId],
      );
      if (agentResult.rows.length === 0) return undefined;
      if (agentResult.rows.length !== 1 || !agentResult.rows[0]) {
        throw new Error("Canonical Agent query returned an invalid cardinality");
      }
      const conversations = await client.query<ConversationRow>(
        `SELECT id, project_id, title, created_at
           FROM agent_world.conversations
          WHERE agent_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [agentId],
      );
      return AgentConversationListSchema.parse({
        schemaVersion: 1,
        generatedAt: this.now().toISOString(),
        agent: { agentId: agentResult.rows[0].id, displayName: agentResult.rows[0].display_name },
        conversations: conversations.rows.map((row) => ({
          conversationId: row.id,
          projectId: row.project_id,
          ...(row.title === null ? {} : { title: row.title }),
          createdAt: iso(row.created_at),
        })),
      });
    } finally {
      client.release();
    }
  }
}
