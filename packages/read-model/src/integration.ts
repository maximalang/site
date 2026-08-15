import { TimestampSchema } from "@agent-world/domain";
import * as z from "zod";

export const IntegrationIdSchema = z
  .string()
  .regex(/^integration_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const IntegrationKindSchema = z.enum(["MCP", "N8N", "GITHUB", "SSH"]);
export const IntegrationActionSchema = z.enum([
  "MCP_LIST_TOOLS",
  "N8N_LIST_WORKFLOWS",
  "GITHUB_LIST_REPOSITORIES",
  "SSH_INSPECT_HOST",
]);
export const IntegrationMutationRequestIdSchema = z
  .string()
  .regex(/^integration_mutation_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const IntegrationToolAllowlistIdSchema = z
  .string()
  .regex(/^integration_tool_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const FixedToolArgumentsSchema = z
  .record(z.string().trim().min(1).max(120), z.json())
  .refine((value) => Object.keys(value).length <= 50, "Too many fixed tool arguments")
  .refine((value) => JSON.stringify(value).length <= 8_192, "Fixed tool arguments are too large");
export const IntegrationMutationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("MCP_CALL_REGISTERED_TOOL"),
    toolAllowlistId: IntegrationToolAllowlistIdSchema,
  }),
  z.strictObject({
    kind: z.literal("GITHUB_DISPATCH_WORKFLOW"),
    owner: z
      .string()
      .trim()
      .min(1)
      .max(39)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
    repository: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/),
    workflowId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9._/-]+$/),
  }),
]);
export const IntegrationToolAllowlistCreateSchema = z.strictObject({
  id: IntegrationToolAllowlistIdSchema,
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(120),
  toolName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._:-]+$/),
  fixedArguments: FixedToolArgumentsSchema,
  createdAt: TimestampSchema,
});
export const IntegrationToolAllowlistSummarySchema = IntegrationToolAllowlistCreateSchema.omit({
  commandId: true,
  createdAt: true,
}).extend({ isEnabled: z.boolean(), createdAt: TimestampSchema });
export const IntegrationMutationStateSchema = z.enum([
  "PENDING",
  "DENIED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN",
]);
export const IntegrationMutationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: IntegrationMutationRequestIdSchema,
  integrationId: IntegrationIdSchema,
  mutation: IntegrationMutationSchema,
  state: IntegrationMutationStateSchema,
  outcome: z.enum(["RECORDED", "REPLAY"]),
  requestedAt: TimestampSchema,
  decidedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  failureCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .optional(),
});
export const IntegrationActionItemSchema = z.strictObject({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  detail: z.string().trim().min(1).max(240).optional(),
});
export const IntegrationActionResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  integrationId: IntegrationIdSchema,
  action: IntegrationActionSchema,
  outcome: z.enum(["RECORDED", "REPLAY"]),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  items: z.array(IntegrationActionItemSchema).max(100),
  executedAt: TimestampSchema,
});
const HttpsEndpointSchema = z
  .string()
  .url()
  .max(2_000)
  .refine(
    (value) =>
      value.startsWith("https://") ||
      /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(value),
    "Remote integration endpoints require HTTPS",
  );

export const IntegrationEndpointSchema = z.discriminatedUnion("transport", [
  z.strictObject({ transport: z.literal("HTTPS"), url: HttpsEndpointSchema }),
  z.strictObject({
    transport: z.literal("SSH"),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/),
    port: z.number().int().min(1).max(65_535).default(22),
    username: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  }),
]);

export const IntegrationSummarySchema = z
  .strictObject({
    id: IntegrationIdSchema,
    kind: IntegrationKindSchema,
    label: z.string().trim().min(1).max(120),
    endpoint: IntegrationEndpointSchema,
    health: z.enum(["UNCONFIGURED", "READY", "ERROR"]),
    isEnabled: z.boolean(),
    hasCredential: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((value, context) => {
    if ((value.kind === "SSH") !== (value.endpoint.transport === "SSH"))
      context.addIssue({ code: "custom", message: "Integration kind and transport conflict" });
  });

export const IntegrationCreateSchema = z
  .strictObject({
    id: IntegrationIdSchema,
    commandId: z.string().trim().min(1).max(512),
    kind: IntegrationKindSchema,
    label: IntegrationSummarySchema.shape.label,
    endpoint: IntegrationEndpointSchema,
    createdAt: TimestampSchema,
  })
  .superRefine((value, context) => {
    if ((value.kind === "SSH") !== (value.endpoint.transport === "SSH"))
      context.addIssue({ code: "custom", message: "Integration kind and transport conflict" });
  });
export const IntegrationRegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: TimestampSchema,
  integrations: z.array(IntegrationSummarySchema).max(200),
  toolAllowlist: z.array(IntegrationToolAllowlistSummarySchema).max(500).optional(),
});
export type IntegrationCreate = z.infer<typeof IntegrationCreateSchema>;
export type IntegrationRegistry = z.infer<typeof IntegrationRegistrySchema>;
export type IntegrationAction = z.infer<typeof IntegrationActionSchema>;
export type IntegrationActionResult = z.infer<typeof IntegrationActionResultSchema>;
export type IntegrationMutation = z.infer<typeof IntegrationMutationSchema>;
export type IntegrationMutationReceipt = z.infer<typeof IntegrationMutationReceiptSchema>;
export type IntegrationToolAllowlistCreate = z.infer<typeof IntegrationToolAllowlistCreateSchema>;
