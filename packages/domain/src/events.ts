import * as z from "zod";
import {
  AgentIdSchema,
  BindingIdSchema,
  EventIdSchema,
  ExecutionAdapterKindSchema,
  OpaqueExternalIdSchema,
  RunIdSchema,
  TaskIdSchema,
} from "./identity.js";
import { CommandIdSchema, TimestampSchema } from "./primitives.js";
import { ApprovalStateSchema } from "./workflow.js";

export const EventSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("RUNTIME"),
    adapterKind: ExecutionAdapterKindSchema,
    bindingId: BindingIdSchema,
    externalEventId: OpaqueExternalIdSchema,
  }),
  z.strictObject({
    kind: z.literal("DOMAIN"),
    actor: z.enum(["OWNER", "SYSTEM_POLICY"]),
    commandId: CommandIdSchema,
  }),
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const AgentStatusSchema = z.enum([
  "IDLE",
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "BLOCKED",
  "FAILED",
  "OFFLINE",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

const WorldEventEnvelope = {
  schemaVersion: z.literal(1),
  id: EventIdSchema,
  sequence: z.number().int().positive(),
  occurredAt: TimestampSchema,
  source: EventSourceSchema,
};

const AgentStatusChangedEventSchema = z.strictObject({
  ...WorldEventEnvelope,
  eventType: z.literal("AGENT_STATUS_CHANGED"),
  payload: z.strictObject({
    agentId: AgentIdSchema,
    status: AgentStatusSchema,
    taskId: TaskIdSchema.optional(),
    runId: RunIdSchema.optional(),
  }),
});

const TaskAssignedEventSchema = z.strictObject({
  ...WorldEventEnvelope,
  eventType: z.literal("TASK_ASSIGNED"),
  payload: z.strictObject({
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
  }),
});

const ApprovalStateChangedEventSchema = z.strictObject({
  ...WorldEventEnvelope,
  eventType: z.literal("APPROVAL_STATE_CHANGED"),
  payload: z.strictObject({
    taskId: TaskIdSchema,
    state: ApprovalStateSchema,
  }),
});

export const WorldEventSchema = z.discriminatedUnion("eventType", [
  AgentStatusChangedEventSchema,
  TaskAssignedEventSchema,
  ApprovalStateChangedEventSchema,
]);
export type WorldEvent = z.infer<typeof WorldEventSchema>;

export const ProjectionCursorSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    stream: z.literal("WORLD"),
    lastSequence: z.number().int().nonnegative(),
    lastEventId: EventIdSchema.optional(),
  })
  .refine(
    (cursor) =>
      cursor.lastSequence === 0
        ? cursor.lastEventId === undefined
        : cursor.lastEventId !== undefined,
    {
      message: "Only the initial cursor may omit lastEventId",
      path: ["lastEventId"],
    },
  );
export type ProjectionCursor = z.infer<typeof ProjectionCursorSchema>;
