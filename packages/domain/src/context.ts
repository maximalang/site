import * as z from "zod";
import {
  AgentIdSchema,
  AgentSchema,
  ArtifactIdSchema,
  ContextItemIdSchema,
  ContextPackIdSchema,
  DocumentChunkIdSchema,
  DocumentIdSchema,
  EventIdSchema,
  ExecutionRouteSchema,
  MessageIdSchema,
  ProjectIdSchema,
  RouteIdSchema,
  RunIdSchema,
  SkillIdSchema,
  TaskIdSchema,
} from "./identity.js";
import { TimestampSchema } from "./primitives.js";
import { TaskIntentSchema } from "./workflow.js";

const ContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedLineSchema = z.string().trim().min(1).max(4_000);
const hasNoControlCharacters = (value: string) =>
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
const EmbeddingSchema = z
  .array(z.number().finite())
  .length(1536)
  .refine((embedding) => embedding.some((value) => value !== 0), "Embedding must be nonzero");

export const RagDocumentSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["PROJECT_FILE", "UPLOAD", "ARTIFACT"]),
    ref: z.string().trim().min(1).max(2_048).refine(hasNoControlCharacters),
    observedAt: TimestampSchema,
  }),
  z.strictObject({
    kind: z.literal("URL"),
    ref: z
      .string()
      .url()
      .max(2_048)
      .regex(/^https:\/\/[^\s/@]+(?:[/:?#]|$)/)
      .refine((value) => !/^https:\/\/[^/\s]+@/.test(value)),
    observedAt: TimestampSchema,
  }),
]);
export type RagDocumentSource = z.infer<typeof RagDocumentSourceSchema>;

export const RagDocumentIngestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: DocumentIdSchema,
  projectId: ProjectIdSchema,
  title: z.string().trim().min(1).max(500),
  contentHash: ContentHashSchema,
  mimeType: z
    .string()
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/)
    .max(200),
  byteSize: z.number().int().positive().max(1_000_000_000),
  source: RagDocumentSourceSchema,
  createdAt: TimestampSchema,
});
export type RagDocumentIngest = z.infer<typeof RagDocumentIngestSchema>;

export const RagDocumentChunkWriteSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: DocumentChunkIdSchema,
    documentId: DocumentIdSchema,
    projectId: ProjectIdSchema,
    ordinal: z.number().int().min(0).max(1_000_000),
    content: z.string().trim().min(1).max(200_000),
    contentHash: ContentHashSchema,
    estimatedTokens: z.number().int().positive().max(100_000),
    embeddingModel: z.string().trim().min(1).max(200).optional(),
    embedding: EmbeddingSchema.optional(),
    createdAt: TimestampSchema,
  })
  .refine((value) => (value.embedding === undefined) === (value.embeddingModel === undefined), {
    message: "Embedding and embedding model must be provided together",
  });
export type RagDocumentChunkWrite = z.infer<typeof RagDocumentChunkWriteSchema>;

export const RagRetrievalRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  embedding: EmbeddingSchema,
  maxItems: z.number().int().min(1).max(100),
  maxDistance: z.number().min(0).max(2).optional(),
});
export type RagRetrievalRequest = z.infer<typeof RagRetrievalRequestSchema>;

export const RagRetrievalResultSchema = z.strictObject({
  chunkId: DocumentChunkIdSchema,
  documentId: DocumentIdSchema,
  projectId: ProjectIdSchema,
  ordinal: z.number().int().nonnegative(),
  content: z.string().min(1).max(200_000),
  contentHash: ContentHashSchema,
  estimatedTokens: z.number().int().positive().max(100_000),
  embeddingModel: z.string().trim().min(1).max(200),
  distance: z.number().min(0).max(2),
  createdAt: TimestampSchema,
});
export type RagRetrievalResult = z.infer<typeof RagRetrievalResultSchema>;

export const ContextTemperatureSchema = z.enum(["HOT", "WARM", "COLD"]);
export type ContextTemperature = z.infer<typeof ContextTemperatureSchema>;

export const ContextKindSchema = z.enum([
  "PROJECT_STATE",
  "DECISION",
  "FINDING",
  "TASK",
  "ARTIFACT",
  "AGENT_RESULT",
  "SKILL",
  "ACTION_HISTORY",
  "MEMORY",
  "RAG_CHUNK",
]);
export type ContextKind = z.infer<typeof ContextKindSchema>;

export const ContextProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("DOMAIN_EVENT"), eventId: EventIdSchema }),
  z.strictObject({ kind: z.literal("MESSAGE"), messageId: MessageIdSchema }),
  z.strictObject({ kind: z.literal("RUN"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("ARTIFACT"), artifactId: ArtifactIdSchema }),
  z.strictObject({ kind: z.literal("DOCUMENT_CHUNK"), documentChunkId: DocumentChunkIdSchema }),
]);
export type ContextProvenance = z.infer<typeof ContextProvenanceSchema>;

export const ContextItemSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: ContextItemIdSchema,
    projectId: ProjectIdSchema,
    kind: ContextKindSchema,
    temperature: ContextTemperatureSchema,
    content: z.string().trim().min(1).max(200_000),
    summary: z.string().trim().min(1).max(20_000).optional(),
    contentHash: ContentHashSchema,
    estimatedTokens: z.number().int().positive().max(100_000),
    importance: z.number().min(0).max(1),
    provenance: ContextProvenanceSchema,
    agentId: AgentIdSchema.optional(),
    taskId: TaskIdSchema.optional(),
    skillId: SkillIdSchema.optional(),
    createdAt: TimestampSchema,
    validUntil: TimestampSchema.optional(),
  })
  .refine(
    (item) =>
      item.validUntil === undefined || Date.parse(item.validUntil) > Date.parse(item.createdAt),
    { message: "Context validity must end after creation", path: ["validUntil"] },
  );
export type ContextItem = z.infer<typeof ContextItemSchema>;

const StructuredArtifactSchema = z.strictObject({
  artifactId: ArtifactIdSchema,
  label: z.string().trim().min(1).max(200),
});

const MemoryCandidateSchema = z.strictObject({
  statement: z.string().trim().min(1).max(8_000),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
});

export const StructuredAgentOutputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fullOutput: z.string().max(5_000_000),
  summary: z.string().trim().min(1).max(20_000),
  findings: z.array(BoundedLineSchema).max(100),
  decisions: z.array(BoundedLineSchema).max(100),
  actions: z.array(BoundedLineSchema).max(100),
  artifacts: z.array(StructuredArtifactSchema).max(100),
  openQuestions: z.array(BoundedLineSchema).max(100),
  nextActions: z.array(BoundedLineSchema).max(100),
  memoryCandidates: z.array(MemoryCandidateSchema).max(100),
  confidence: z.number().min(0).max(1),
});
export type StructuredAgentOutput = z.infer<typeof StructuredAgentOutputSchema>;

export const ContextCompilerInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    packId: ContextPackIdSchema,
    runId: RunIdSchema,
    task: TaskIntentSchema,
    agent: AgentSchema,
    project: z.strictObject({
      id: ProjectIdSchema,
      name: z.string().trim().min(1).max(200),
      state: z.string().trim().min(1).max(50_000),
    }),
    route: ExecutionRouteSchema,
    tokenBudget: z.number().int().min(256).max(1_000_000),
    expectedOutput: z.string().trim().min(1).max(20_000),
    handoffContract: z.string().trim().min(1).max(20_000),
    availableTools: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .superRefine((input, context) => {
    if (input.task.projectId !== input.project.id) {
      context.addIssue({ code: "custom", message: "Task and project must match" });
    }
    if (input.task.assigneeAgentId !== input.agent.id) {
      context.addIssue({ code: "custom", message: "Task and Agent must match" });
    }
  });
export type ContextCompilerInput = z.infer<typeof ContextCompilerInputSchema>;

export const ContextPackSectionNameSchema = z.enum([
  "GOAL",
  "CURRENT_PROJECT_STATE",
  "RELEVANT_DECISIONS",
  "RELEVANT_MEMORY",
  "RELEVANT_FINDINGS",
  "REQUIRED_SKILLS",
  "AVAILABLE_TOOLS",
  "ARTIFACT_REFERENCES",
  "EXPECTED_OUTPUT",
  "HANDOFF_CONTRACT",
]);
export type ContextPackSectionName = z.infer<typeof ContextPackSectionNameSchema>;

export const CONTEXT_PACK_SECTION_ORDER = ContextPackSectionNameSchema.options;

const ContextPackEvidenceSchema = z.strictObject({
  contextItemId: ContextItemIdSchema,
  section: ContextPackSectionNameSchema,
  contentHash: ContentHashSchema,
  score: z.number().min(0).max(1_000),
  provenance: ContextProvenanceSchema,
});

export const ContextPackSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    compilerVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    id: ContextPackIdSchema,
    runId: RunIdSchema,
    taskId: TaskIdSchema,
    agentId: AgentIdSchema,
    projectId: ProjectIdSchema,
    routeId: RouteIdSchema,
    tokenBudget: z.number().int().min(256).max(1_000_000),
    estimatedTokens: z.number().int().nonnegative().max(1_000_000),
    contentHash: ContentHashSchema,
    compiledAt: TimestampSchema,
    sections: z.array(
      z.strictObject({
        name: ContextPackSectionNameSchema,
        content: z.string().max(500_000),
      }),
    ),
    rendered: z.string().max(2_000_000),
    evidence: z.array(ContextPackEvidenceSchema).max(1_000),
  })
  .superRefine((pack, context) => {
    if (pack.estimatedTokens > pack.tokenBudget) {
      context.addIssue({ code: "custom", message: "ContextPack exceeds its token budget" });
    }
    if (
      pack.sections.length !== CONTEXT_PACK_SECTION_ORDER.length ||
      pack.sections.some((section, index) => section.name !== CONTEXT_PACK_SECTION_ORDER[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "ContextPack sections are incomplete or reordered",
      });
    }
  });
export type ContextPack = z.infer<typeof ContextPackSchema>;
