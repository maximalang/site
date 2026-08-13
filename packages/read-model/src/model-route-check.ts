import {
  AccountIdSchema,
  ModelRouteIdSchema,
  ProviderIdSchema,
  RunIdSchema,
} from "@agent-world/domain";
import * as z from "zod";

export const ModelRouteCheckRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelRouteId: ModelRouteIdSchema,
});
export type ModelRouteCheckRequest = z.infer<typeof ModelRouteCheckRequestSchema>;

export const ModelRouteCheckResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  modelRouteId: ModelRouteIdSchema,
  providerId: ProviderIdSchema,
  accountId: AccountIdSchema.optional(),
  mode: z.enum(["API", "LOCAL"]),
  remoteModelId: z.string().min(1).max(512),
  status: z.literal("SUCCEEDED"),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
});
export type ModelRouteCheckResponse = z.infer<typeof ModelRouteCheckResponseSchema>;
