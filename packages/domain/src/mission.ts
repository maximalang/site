import * as z from "zod";
import {
  AgentIdSchema,
  AgentTemplateIdSchema,
  EventIdSchema,
  MissionCriterionIdSchema,
  MissionDecompositionIdSchema,
  MissionIdSchema,
  ProjectIdSchema,
  SkillIdSchema,
  StructuredMeetingIdSchema,
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

const DecompositionTaskKeySchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const MissionTaskProposalSchema = z.strictObject({
  key: DecompositionTaskKeySchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000).optional(),
  assigneeAgentId: AgentIdSchema,
  dependsOn: z
    .array(DecompositionTaskKeySchema)
    .max(99)
    .refine(
      (keys) => keys.every((key, index) => index === 0 || String(keys[index - 1]) < key),
      "Task dependencies must be unique and sorted",
    ),
});

export const MissionDecompositionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: MissionDecompositionIdSchema,
    missionId: MissionIdSchema,
    projectId: ProjectIdSchema,
    sourceEventId: EventIdSchema,
    rationale: z.string().trim().min(1).max(20_000),
    tasks: z.array(MissionTaskProposalSchema).min(1).max(100),
    createdAt: TimestampSchema,
  })
  .superRefine((decomposition, context) => {
    const tasks = new Map(decomposition.tasks.map((task) => [task.key, task]));
    if (tasks.size !== decomposition.tasks.length) {
      context.addIssue({ code: "custom", message: "Decomposition Task keys must be unique" });
      return;
    }
    for (const task of decomposition.tasks) {
      if (task.dependsOn.includes(task.key)) {
        context.addIssue({ code: "custom", message: "Decomposition contains a dependency cycle" });
      }
      for (const dependency of task.dependsOn) {
        if (!tasks.has(dependency)) {
          context.addIssue({ code: "custom", message: "Task dependency is outside decomposition" });
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): boolean => {
      if (visiting.has(key)) return false;
      if (visited.has(key)) return true;
      visiting.add(key);
      for (const dependency of tasks.get(key)?.dependsOn ?? []) {
        if (!visit(dependency)) return false;
      }
      visiting.delete(key);
      visited.add(key);
      return true;
    };
    if ([...tasks.keys()].some((key) => !visit(key))) {
      context.addIssue({ code: "custom", message: "Decomposition contains a dependency cycle" });
    }
  });
export type MissionDecomposition = z.infer<typeof MissionDecompositionSchema>;

const MeetingPositionSchema = z.strictObject({
  agentId: AgentIdSchema,
  position: z.string().trim().min(1).max(8_000),
  evidenceRefs: z.array(z.string().trim().min(1).max(512)).max(100),
});

export const StructuredMeetingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: StructuredMeetingIdSchema,
  missionId: MissionIdSchema,
  projectId: ProjectIdSchema,
  topic: z.string().trim().min(1).max(2_000),
  positions: z
    .array(MeetingPositionSchema)
    .min(2)
    .max(20)
    .refine(
      (positions) =>
        positions.every(
          (position, index) =>
            index === 0 || String(positions[index - 1]?.agentId) < String(position.agentId),
        ),
      "Meeting positions must contain unique sorted Agents",
    ),
  synthesis: z.string().trim().min(1).max(20_000),
  decision: z.string().trim().min(1).max(8_000),
  sourceEventIds: sortedUniqueIds(EventIdSchema).refine(
    (ids) => ids.length > 0,
    "A meeting decision requires canonical source Events",
  ),
  decidedAt: TimestampSchema,
});
export type StructuredMeeting = z.infer<typeof StructuredMeetingSchema>;
