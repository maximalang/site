import * as z from "zod";
import {
  AgentIdSchema,
  AgentTemplateIdSchema,
  MissionCriterionIdSchema,
  MissionIdSchema,
  ProjectIdSchema,
  SkillIdSchema,
  ToolIdSchema,
} from "./identity.js";
import { TimestampSchema } from "./primitives.js";

const SlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function sortedUniqueIds<T extends z.ZodType>(schema: T) {
  return z
    .array(schema)
    .max(500)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || String(ids[index - 1]) < String(id)),
      "Identifiers must be unique and sorted",
    );
}

export const MissionSuccessCriterionSchema = z.strictObject({
  id: MissionCriterionIdSchema,
  statement: z.string().trim().min(1).max(2_000),
  verification: z.enum(["ARTIFACT", "METRIC", "TEST", "OWNER_CONFIRMATION"]),
  status: z.enum(["PENDING", "PASSED", "FAILED"]),
  evidenceRefs: z.array(z.string().trim().min(1).max(512)).max(100).default([]),
});
export type MissionSuccessCriterion = z.infer<typeof MissionSuccessCriterionSchema>;

export const MissionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: MissionIdSchema,
    projectId: ProjectIdSchema,
    title: z.string().trim().min(1).max(200),
    goal: z.string().trim().min(1).max(20_000),
    status: z.enum(["DRAFT", "ACTIVE", "SUCCEEDED", "FAILED", "CANCELLED"]),
    successCriteria: z.array(MissionSuccessCriterionSchema).min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((mission, context) => {
    if (Date.parse(mission.updatedAt) < Date.parse(mission.createdAt)) {
      context.addIssue({ code: "custom", message: "Mission update precedes creation" });
    }
    const criterionIds = mission.successCriteria.map((criterion) => criterion.id);
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({ code: "custom", message: "Mission criteria must be unique" });
    }
    if (
      mission.status === "SUCCEEDED" &&
      mission.successCriteria.some((criterion) => criterion.status !== "PASSED")
    ) {
      context.addIssue({
        code: "custom",
        message: "A succeeded Mission requires all criteria to pass",
      });
    }
  });
export type Mission = z.infer<typeof MissionSchema>;

export const AgentTemplateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: AgentTemplateIdSchema,
  version: z.number().int().positive().max(1_000_000),
  slug: SlugSchema,
  displayName: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(32_000),
  skillIds: sortedUniqueIds(SkillIdSchema),
  toolIds: sortedUniqueIds(ToolIdSchema),
  createdAt: TimestampSchema,
});
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

export const AgentInstanceAssignmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  agentId: AgentIdSchema,
  templateId: AgentTemplateIdSchema,
  templateVersion: z.number().int().positive().max(1_000_000),
  projectId: ProjectIdSchema,
  missionId: MissionIdSchema.optional(),
  createdAt: TimestampSchema,
});
export type AgentInstanceAssignment = z.infer<typeof AgentInstanceAssignmentSchema>;
