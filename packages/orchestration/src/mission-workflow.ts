import { EventIdSchema, MissionIdSchema, RunIdSchema, TaskIdSchema } from "@agent-world/domain";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type pg from "pg";
import * as z from "zod";

export const MissionWorkflowPhaseSchema = z.enum([
  "PLANNING",
  "EXECUTING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
]);
export const MissionWorkflowActionSchema = z.enum([
  "DECOMPOSE_MISSION",
  "DISPATCH_READY_TASKS",
  "WAIT_FOR_RUNS",
  "RETRY_FAILED_TASKS",
  "REVIEW_RESULTS",
  "RECORD_SUCCESS",
  "RECORD_FAILURE",
]);

export const MissionWorkflowInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  missionId: MissionIdSchema,
  taskIds: z.array(TaskIdSchema).max(1_000),
  runIds: z.array(RunIdSchema).max(1_000),
  completedTaskIds: z.array(TaskIdSchema).max(1_000),
  failedTaskIds: z.array(TaskIdSchema).max(1_000),
  lastEventId: EventIdSchema.optional(),
  phase: MissionWorkflowPhaseSchema,
  retryCount: z.number().int().min(0).max(100),
  maxRetries: z.number().int().min(0).max(100),
  reviewRequired: z.boolean(),
});
export type MissionWorkflowInput = z.infer<typeof MissionWorkflowInputSchema>;
export const MissionWorkflowResultSchema = MissionWorkflowInputSchema.extend({
  pendingAction: MissionWorkflowActionSchema.optional(),
});
export type MissionWorkflowResult = z.infer<typeof MissionWorkflowResultSchema>;

export type MissionWorkflowStateReader = {
  readWorkflowState(missionId: z.infer<typeof MissionIdSchema>): Promise<MissionWorkflowInput>;
};

const MissionWorkflowState = new StateSchema({
  schemaVersion: z.literal(1),
  missionId: MissionIdSchema,
  taskIds: z.array(TaskIdSchema),
  runIds: z.array(RunIdSchema),
  completedTaskIds: z.array(TaskIdSchema),
  failedTaskIds: z.array(TaskIdSchema),
  lastEventId: EventIdSchema.optional(),
  phase: MissionWorkflowPhaseSchema,
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  reviewRequired: z.boolean(),
  pendingAction: MissionWorkflowActionSchema.optional(),
});

function decide(state: typeof MissionWorkflowState.State) {
  const { pendingAction: _pendingAction, ...canonicalState } = state;
  const input = MissionWorkflowInputSchema.parse(canonicalState);
  const taskIds = new Set(input.taskIds);
  if (!input.completedTaskIds.every((taskId) => taskIds.has(taskId))) {
    throw new Error("Completed Task is outside the canonical Mission");
  }
  if (!input.failedTaskIds.every((taskId) => taskIds.has(taskId))) {
    throw new Error("Failed Task is outside the canonical Mission");
  }
  if (input.taskIds.length === 0) {
    return { phase: "PLANNING" as const, pendingAction: "DECOMPOSE_MISSION" as const };
  }
  if (input.failedTaskIds.length > 0) {
    return input.retryCount < input.maxRetries
      ? { phase: "EXECUTING" as const, pendingAction: "RETRY_FAILED_TASKS" as const }
      : { phase: "FAILED" as const, pendingAction: "RECORD_FAILURE" as const };
  }
  if (input.completedTaskIds.length < input.taskIds.length) {
    return {
      phase: "EXECUTING" as const,
      pendingAction:
        input.runIds.length === 0 ? ("DISPATCH_READY_TASKS" as const) : ("WAIT_FOR_RUNS" as const),
    };
  }
  return input.reviewRequired
    ? { phase: "REVIEWING" as const, pendingAction: "REVIEW_RESULTS" as const }
    : { phase: "COMPLETED" as const, pendingAction: "RECORD_SUCCESS" as const };
}

export function createMissionWorkflow(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(MissionWorkflowState)
    .addNode("decide", decide)
    .addEdge(START, "decide")
    .addEdge("decide", END)
    .compile({ checkpointer });
}

export class MissionWorkflowService {
  private readonly graph;

  constructor(
    checkpointer: BaseCheckpointSaver,
    private readonly stateReader: MissionWorkflowStateReader,
  ) {
    this.graph = createMissionWorkflow(checkpointer);
  }

  async advance(missionIdInput: unknown): Promise<MissionWorkflowResult> {
    const missionId = MissionIdSchema.parse(missionIdInput);
    const canonicalState = MissionWorkflowInputSchema.parse(
      await this.stateReader.readWorkflowState(missionId),
    );
    if (canonicalState.missionId !== missionId) {
      throw new Error("Mission workflow reader returned a different canonical Mission");
    }
    return MissionWorkflowResultSchema.parse(
      await this.graph.invoke(canonicalState, {
        configurable: { thread_id: missionId },
      }),
    );
  }
}

export async function createPostgresMissionCheckpointer(connectionString: string) {
  const parsed = new URL(connectionString);
  if (!parsed.protocol.startsWith("postgres")) throw new Error("PostgreSQL connection is required");
  const checkpointer = PostgresSaver.fromConnString(connectionString, {
    schema: "agent_world_langgraph",
  });
  await checkpointer.setup();
  return checkpointer;
}

export async function createPostgresMissionCheckpointerFromPool(pool: pg.Pool) {
  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: "agent_world_langgraph",
  });
  await checkpointer.setup();
  return checkpointer;
}
