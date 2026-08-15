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
});
export type IntegrationCreate = z.infer<typeof IntegrationCreateSchema>;
export type IntegrationRegistry = z.infer<typeof IntegrationRegistrySchema>;
export type IntegrationAction = z.infer<typeof IntegrationActionSchema>;
export type IntegrationActionResult = z.infer<typeof IntegrationActionResultSchema>;
