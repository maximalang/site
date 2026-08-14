import type pg from "pg";
import {
  createPostgresMissionCheckpointerFromPool,
  MissionWorkflowInputSchema,
  MissionWorkflowService,
} from "./mission-workflow.js";

export type ProductionMissionWorkflowResult = {
  schemaVersion: 1;
  missionId: string;
  taskIds: string[];
  runIds: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  lastEventId?: string | undefined;
  phase: "PLANNING" | "EXECUTING" | "REVIEWING" | "COMPLETED" | "FAILED";
  retryCount: number;
  maxRetries: number;
  reviewRequired: boolean;
  pendingAction?:
    | "DECOMPOSE_MISSION"
    | "DISPATCH_READY_TASKS"
    | "WAIT_FOR_RUNS"
    | "RETRY_FAILED_TASKS"
    | "REVIEW_RESULTS"
    | "RECORD_SUCCESS"
    | "RECORD_FAILURE"
    | undefined;
};

export type ProductionMissionWorkflow = {
  advance(missionId: unknown): Promise<ProductionMissionWorkflowResult>;
  stop(): Promise<void>;
};

export async function createProductionMissionWorkflow(
  poolInput: unknown,
  stateReader: { readWorkflowState(missionId: unknown): Promise<unknown> },
): Promise<ProductionMissionWorkflow> {
  const checkpointer = await createPostgresMissionCheckpointerFromPool(poolInput as pg.Pool);
  const service = new MissionWorkflowService(checkpointer, {
    readWorkflowState: async (missionId) =>
      MissionWorkflowInputSchema.parse(await stateReader.readWorkflowState(missionId)),
  });
  return {
    advance: (missionId) => service.advance(missionId),
    stop: () => checkpointer.end(),
  };
}
