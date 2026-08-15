import { OpaqueExternalIdSchema, TimestampSchema } from "@agent-world/domain";
import * as z from "zod";
import { type ModelGateway, ModelGatewayFailure, ModelGatewayResultSchema } from "./contract.js";
import { type ModelTaskExecutionRequest, ModelTaskExecutionRequestSchema } from "./task-adapter.js";

const PreparationSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("EXECUTE"), externalRunId: OpaqueExternalIdSchema }),
  z.strictObject({
    outcome: z.literal("REPLAY"),
    externalRunId: OpaqueExternalIdSchema,
    acceptedAt: TimestampSchema,
  }),
]);
const ObservationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("RUNNING"), observedAt: TimestampSchema }),
  z.strictObject({ status: z.literal("COMPLETED"), observedAt: TimestampSchema }),
  z.strictObject({
    status: z.literal("FAILED"),
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    observedAt: TimestampSchema,
  }),
]);

export interface DurableModelExecutionStore {
  prepare(
    request: ModelTaskExecutionRequest,
    externalRunId: string,
    acceptedAt: string,
  ): Promise<unknown>;
  complete(externalRunId: string, result: unknown, completedAt: string): Promise<unknown>;
  fail(externalRunId: string, failureCode: string, completedAt: string): Promise<unknown>;
  observe(externalRunId: string, observedAt: string): Promise<unknown>;
}

export class DurableModelExecutionDispatcher {
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      gateway: ModelGateway;
      store: DurableModelExecutionStore;
      executionId: () => string;
      now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async dispatch(input: ModelTaskExecutionRequest) {
    const request = ModelTaskExecutionRequestSchema.parse(input);
    const acceptedAt = this.now().toISOString();
    const generatedId = OpaqueExternalIdSchema.parse(this.options.executionId());
    const prepared = PreparationSchema.parse(
      await this.options.store.prepare(request, generatedId, acceptedAt),
    );
    if (prepared.outcome === "REPLAY") {
      return { acceptedAt: prepared.acceptedAt, externalRunId: prepared.externalRunId };
    }
    try {
      const result = ModelGatewayResultSchema.parse(
        await this.options.gateway.complete({
          schemaVersion: 1,
          runId: request.runId,
          modelRouteId: request.modelRouteId,
          messages: [
            { role: "SYSTEM", content: request.prompt },
            {
              role: "USER",
              content: "Complete the task and return the requested structured result.",
            },
          ],
          maxOutputTokens: request.maxOutputTokens,
          temperature: 0.2,
          timeoutMs: 600_000,
          idempotencyKey: request.idempotencyKey,
        }),
      );
      await this.options.store.complete(prepared.externalRunId, result, this.now().toISOString());
    } catch (error) {
      const failureCode =
        error instanceof ModelGatewayFailure ? error.code : "UPSTREAM_UNAVAILABLE";
      await this.options.store.fail(prepared.externalRunId, failureCode, this.now().toISOString());
    }
    return { acceptedAt, externalRunId: prepared.externalRunId };
  }

  async observe(externalRunIdValue: string, _timeoutMs: number) {
    const externalRunId = OpaqueExternalIdSchema.parse(externalRunIdValue);
    return ObservationSchema.parse(
      await this.options.store.observe(externalRunId, this.now().toISOString()),
    );
  }
}
