import {
  type MemoryGraphProjectionPort,
  type MemoryProjectionEvent,
  MemoryProjectionEventSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";

type QueryPool = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

type EventRow = QueryResultRow & {
  sequence: string | number;
  id: string;
  event_type: string;
  project_id: string;
  proposal_id: string;
  decision_id: string | null;
  source_context_item_id: string;
  materialized_context_item_id: string | null;
  action: string | null;
  content: string;
  occurred_at: Date | string;
};

const ProjectionNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9._-]*$/);

function positiveLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("Memory projection batch must be between 1 and 500");
  }
  return value;
}

function sequence(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid memory sequence");
  return parsed;
}

export class MemoryProjectionCheckpointConflictError extends Error {
  constructor() {
    super("MEMORY_PROJECTION_CHECKPOINT_CONFLICT");
    this.name = "MemoryProjectionCheckpointConflictError";
  }
}

export class PostgresMemoryProjectionStore {
  constructor(private readonly pool: QueryPool) {}

  async readEvents(afterSequence: number, limitValue = 100): Promise<MemoryProjectionEvent[]> {
    const after = sequence(afterSequence);
    const limit = positiveLimit(limitValue);
    const result = await this.pool.query<EventRow>(
      `SELECT sequence, id, event_type, project_id, proposal_id, decision_id,
              source_context_item_id, materialized_context_item_id, action,
              content, occurred_at
         FROM agent_world.memory_events
        WHERE sequence > $1
        ORDER BY sequence, id
        LIMIT $2`,
      [after, limit],
    );
    return result.rows.map((row) =>
      MemoryProjectionEventSchema.parse({
        schemaVersion: 1,
        sequence: sequence(row.sequence),
        eventId: row.id,
        eventType: row.event_type,
        projectId: row.project_id,
        proposalId: row.proposal_id,
        ...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
        ...(row.action === null ? {} : { action: row.action }),
        sourceContextItemId: row.source_context_item_id,
        ...(row.materialized_context_item_id === null
          ? {}
          : { materializedContextItemId: row.materialized_context_item_id }),
        content: row.content,
        occurredAt: TimestampSchema.parse(
          row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
        ),
      }),
    );
  }

  async readCheckpoint(projectionNameValue: unknown): Promise<number> {
    const projectionName = ProjectionNameSchema.parse(projectionNameValue);
    const result = await this.pool.query<{ last_sequence: string | number }>(
      `SELECT last_sequence FROM agent_world.memory_projection_checkpoints
        WHERE projection_name = $1`,
      [projectionName],
    );
    return result.rows[0] ? sequence(result.rows[0].last_sequence) : 0;
  }

  async advanceCheckpoint(
    projectionNameValue: unknown,
    expectedValue: number,
    nextValue: number,
    nowValue: unknown,
  ): Promise<void> {
    const projectionName = ProjectionNameSchema.parse(projectionNameValue);
    const expected = sequence(expectedValue);
    const next = sequence(nextValue);
    const now = TimestampSchema.parse(nowValue);
    if (next <= expected) throw new MemoryProjectionCheckpointConflictError();
    const result = await this.pool.query<{ last_sequence: string | number }>(
      `INSERT INTO agent_world.memory_projection_checkpoints
         (projection_name, last_sequence, updated_at)
       VALUES ($1, $3, $4)
       ON CONFLICT (projection_name) DO UPDATE
         SET last_sequence = EXCLUDED.last_sequence, updated_at = EXCLUDED.updated_at
       WHERE agent_world.memory_projection_checkpoints.last_sequence = $2
       RETURNING last_sequence`,
      [projectionName, expected, next, now],
    );
    if (result.rows.length !== 1 || sequence(result.rows[0]?.last_sequence ?? -1) !== next) {
      throw new MemoryProjectionCheckpointConflictError();
    }
  }
}

export class MemoryGraphProjector {
  constructor(
    private readonly store: Pick<
      PostgresMemoryProjectionStore,
      "readCheckpoint" | "readEvents" | "advanceCheckpoint"
    >,
    private readonly port: MemoryGraphProjectionPort,
    private readonly options: { projectionName: string; now?: () => string },
  ) {
    ProjectionNameSchema.parse(options.projectionName);
  }

  async runBatch(limitValue = 100): Promise<{ applied: number; appliedThrough: number }> {
    const limit = positiveLimit(limitValue);
    const checkpoint = await this.store.readCheckpoint(this.options.projectionName);
    const events = await this.store.readEvents(checkpoint, limit);
    if (events.length === 0) return { applied: 0, appliedThrough: checkpoint };
    const lastSequence = events.at(-1)?.sequence;
    if (!lastSequence) throw new Error("Memory projection batch has no terminal sequence");
    const receipt = await this.port.apply(events);
    if (receipt.appliedThrough !== lastSequence) {
      throw new Error("Memory graph adapter did not acknowledge the exact batch");
    }
    await this.store.advanceCheckpoint(
      this.options.projectionName,
      checkpoint,
      lastSequence,
      this.options.now?.() ?? new Date().toISOString(),
    );
    return { applied: events.length, appliedThrough: lastSequence };
  }
}
