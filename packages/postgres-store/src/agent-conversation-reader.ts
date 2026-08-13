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
  task_assignment_available: boolean;
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
        `SELECT c.id, c.project_id, c.title, c.created_at,
                EXISTS (
                  SELECT 1
                    FROM agent_world.conversation_sessions s
                    JOIN agent_world.runtime_bindings b
                      ON b.id = s.binding_id
                     AND b.agent_id = s.agent_id
                     AND b.adapter_kind = s.adapter_kind
                   WHERE s.conversation_id = c.id
                     AND s.agent_id = c.agent_id
                     AND s.ended_at IS NULL
                     AND s.adapter_kind = 'OPENCLAW'
                     AND b.is_enabled = true
                ) AS task_assignment_available
           FROM agent_world.conversations c
          WHERE c.agent_id = $1
          ORDER BY c.created_at DESC, c.id DESC
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
          taskAssignmentAvailable: row.task_assignment_available,
        })),
      });
    } finally {
      client.release();
    }
  }
}
