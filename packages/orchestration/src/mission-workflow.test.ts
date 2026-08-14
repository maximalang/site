import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import {
  createMissionWorkflow,
  MissionWorkflowInputSchema,
  MissionWorkflowService,
} from "./mission-workflow.js";

const ids = {
  mission: "mission_11111111-1111-1111-1111-111111111111",
  task: "task_22222222-2222-2222-2222-222222222222",
  run: "run_33333333-3333-3333-3333-333333333333",
  event: "event_44444444-4444-4444-4444-444444444444",
};

describe("Mission LangGraph workflow", () => {
  it("checkpoints a canonical Mission thread and requests decomposition without side effects", async () => {
    const checkpointer = new MemorySaver();
    const graph = createMissionWorkflow(checkpointer);
    const input = MissionWorkflowInputSchema.parse({
      schemaVersion: 1,
      missionId: ids.mission,
      taskIds: [],
      runIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      phase: "PLANNING",
      retryCount: 0,
      maxRetries: 2,
      reviewRequired: true,
    });
    const config = { configurable: { thread_id: ids.mission } };

    const result = await graph.invoke(input, config);
    const checkpoint = await graph.getState(config);

    expect(result).toMatchObject({ phase: "PLANNING", pendingAction: "DECOMPOSE_MISSION" });
    expect(checkpoint.values).toMatchObject({ missionId: ids.mission });
    expect(checkpoint.config.configurable?.thread_id).toBe(ids.mission);
  });

  it("routes canonical task outcomes through retry, review and completion", async () => {
    const graph = createMissionWorkflow(new MemorySaver());
    const base = {
      schemaVersion: 1 as const,
      missionId: ids.mission,
      taskIds: [ids.task],
      runIds: [ids.run],
      completedTaskIds: [] as string[],
      failedTaskIds: [ids.task],
      lastEventId: ids.event,
      phase: "EXECUTING" as const,
      retryCount: 0,
      maxRetries: 2,
      reviewRequired: true,
    };
    await expect(
      graph.invoke(base, { configurable: { thread_id: ids.mission } }),
    ).resolves.toMatchObject({ phase: "EXECUTING", pendingAction: "RETRY_FAILED_TASKS" });

    await expect(
      graph.invoke(
        { ...base, completedTaskIds: [ids.task], failedTaskIds: [], retryCount: 1 },
        { configurable: { thread_id: ids.mission } },
      ),
    ).resolves.toMatchObject({ phase: "REVIEWING", pendingAction: "REVIEW_RESULTS" });

    await expect(
      graph.invoke(
        {
          ...base,
          completedTaskIds: [ids.task],
          failedTaskIds: [],
          retryCount: 1,
          reviewRequired: false,
        },
        { configurable: { thread_id: ids.mission } },
      ),
    ).resolves.toMatchObject({ phase: "COMPLETED", pendingAction: "RECORD_SUCCESS" });
  });

  it("advances from canonical storage instead of trusting caller-supplied workflow state", async () => {
    const service = new MissionWorkflowService(new MemorySaver(), {
      readWorkflowState: async (missionId) => ({
        schemaVersion: 1,
        missionId,
        taskIds: [],
        runIds: [],
        completedTaskIds: [],
        failedTaskIds: [],
        phase: "PLANNING",
        retryCount: 0,
        maxRetries: 2,
        reviewRequired: true,
      }),
    });

    await expect(service.advance(ids.mission)).resolves.toMatchObject({
      missionId: ids.mission,
      pendingAction: "DECOMPOSE_MISSION",
    });
    await expect(service.advance("mission_not-canonical")).rejects.toThrow();
  });
});
