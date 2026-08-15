import * as z from "zod";
import { AgentIdSchema, MissionIdSchema, ProjectIdSchema, ScheduleIdSchema } from "./identity.js";
import { TimestampSchema } from "./primitives.js";

export const AgentScheduleSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: ScheduleIdSchema,
    projectId: ProjectIdSchema,
    agentId: AgentIdSchema,
    missionId: MissionIdSchema.optional(),
    title: z.string().trim().min(1).max(200),
    taskDescription: z.string().trim().min(1).max(20_000).optional(),
    cronExpression: z.string().trim().min(9).max(128),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/),
    isEnabled: z.boolean(),
    nextFireAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((schedule, context) => {
    if (Date.parse(schedule.updatedAt) < Date.parse(schedule.createdAt)) {
      context.addIssue({ code: "custom", message: "Schedule update precedes creation" });
    }
    if (schedule.isEnabled && schedule.nextFireAt === undefined) {
      context.addIssue({ code: "custom", message: "Enabled schedule requires next fire time" });
    }
    if (
      schedule.nextFireAt !== undefined &&
      Date.parse(schedule.nextFireAt) < Date.parse(schedule.createdAt)
    ) {
      context.addIssue({ code: "custom", message: "Schedule next fire precedes creation" });
    }
  });
export type AgentSchedule = z.infer<typeof AgentScheduleSchema>;
