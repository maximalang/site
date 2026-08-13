import {
  type Agent,
  AgentIdSchema,
  AgentStatusSchema,
  BindingIdSchema,
  EventIdSchema,
  OpaqueExternalIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import {
  buildLiveRuntimeWorldReadModel,
  buildUnavailableWorldReadModel,
  type WorldReadModel,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const OpenClawStatusSchema = z.strictObject({
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  status: AgentStatusSchema,
});

const SnapshotSchema = z.strictObject({
  observedAt: TimestampSchema,
  observationId: OpaqueExternalIdSchema,
  statuses: z.array(OpenClawStatusSchema).max(1_000),
});

type StatusRow = QueryResultRow & { status: string };
type ProjectionRow = QueryResultRow & { agent_id: string; status: string };
type CursorRow = QueryResultRow & {
  sequence: string | number;
  id: string;
  occurred_at: Date | string;
};
type SequenceRow = QueryResultRow & { last_sequence: string | number };

export type OpenClawWorldSnapshot = z.input<typeof SnapshotSchema>;

function safeSequence(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("World event sequence exceeds the safe read-model range");
  }
  return value;
}

export class PostgresWorldProjectionStore {
  private readonly eventId: () => string;

  constructor(
    private readonly pool: TransactionPool,
    options: { eventId?: () => string } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
  }

  async applyOpenClawSnapshot(input: OpenClawWorldSnapshot): Promise<void> {
    const snapshot = SnapshotSchema.parse(input);
    const seenAgents = new Set<string>();
    const seenBindings = new Set<string>();
    for (const status of snapshot.statuses) {
      if (seenAgents.has(status.agentId) || seenBindings.has(status.bindingId)) {
        throw new Error("OpenClaw World snapshot contains duplicate canonical identity");
      }
      seenAgents.add(status.agentId);
      seenBindings.add(status.bindingId);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "agent_world:world_projection",
      ]);
      for (const status of snapshot.statuses.toSorted((left, right) =>
        left.agentId.localeCompare(right.agentId),
      )) {
        const current = await client.query<StatusRow>(
          `SELECT status
             FROM agent_world.world_agent_status
            WHERE agent_id = $1
            FOR UPDATE`,
          [status.agentId],
        );
        if (current.rows.length > 1) {
          throw new Error("World status projection returned an invalid cardinality");
        }
        if (current.rows[0]?.status === status.status) continue;

        const eventId = EventIdSchema.parse(this.eventId());
        const externalEventId = OpaqueExternalIdSchema.parse(
          `${snapshot.observationId}:${status.bindingId}`,
        );
        const sequence = await client.query<SequenceRow>(
          `UPDATE agent_world.world_event_stream
              SET last_sequence = last_sequence + 1
            WHERE singleton = true
          RETURNING last_sequence`,
        );
        if (sequence.rows.length !== 1 || !sequence.rows[0]) {
          throw new Error("World event stream counter is unavailable");
        }
        const nextSequence = safeSequence(sequence.rows[0].last_sequence);
        await client.query(
          `INSERT INTO agent_world.world_events
             (sequence, id, occurred_at, source_kind, adapter_kind, binding_id,
              external_event_id, event_type, agent_id, status)
           VALUES ($1, $2, $3, 'RUNTIME', 'OPENCLAW', $4, $5,
                   'AGENT_STATUS_CHANGED', $6, $7)`,
          [
            nextSequence,
            eventId,
            snapshot.observedAt,
            status.bindingId,
            externalEventId,
            status.agentId,
            status.status,
          ],
        );
        await client.query(
          `INSERT INTO agent_world.world_agent_status
             (agent_id, status, last_event_id, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id) DO UPDATE
             SET status = EXCLUDED.status,
                 last_event_id = EXCLUDED.last_event_id,
                 updated_at = EXCLUDED.updated_at`,
          [status.agentId, status.status, eventId, snapshot.observedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the projection failure; the pool will discard a broken client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async readWorld(agents: Agent[]): Promise<WorldReadModel> {
    if (agents.length === 0) {
      return buildUnavailableWorldReadModel(new Date(0).toISOString());
    }
    const client = await this.pool.connect();
    try {
      const [statuses, cursor] = await Promise.all([
        client.query<ProjectionRow>(
          `SELECT agent_id, status
             FROM agent_world.world_agent_status
            ORDER BY agent_id`,
        ),
        client.query<CursorRow>(
          `SELECT sequence, id, occurred_at
             FROM agent_world.world_events
            ORDER BY sequence DESC
            LIMIT 1`,
        ),
      ]);
      if (cursor.rows.length > 1)
        throw new Error("World cursor query returned invalid cardinality");
      const latest = cursor.rows[0];
      const generatedAt = latest
        ? latest.occurred_at instanceof Date
          ? latest.occurred_at.toISOString()
          : latest.occurred_at
        : new Date(0).toISOString();
      return buildLiveRuntimeWorldReadModel({
        generatedAt,
        cursor: latest
          ? {
              schemaVersion: 1,
              stream: "WORLD",
              lastSequence: safeSequence(latest.sequence),
              lastEventId: EventIdSchema.parse(latest.id),
            }
          : { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
        agents,
        runtimeStatuses: statuses.rows.map((row) => ({
          agentId: row.agent_id,
          status: AgentStatusSchema.parse(row.status),
        })),
      });
    } finally {
      client.release();
    }
  }
}
