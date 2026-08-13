import { AccountIdSchema } from "@agent-world/domain";
import * as z from "zod";

export const ProviderCredentialWriteRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (value) =>
        [...value].every((character) => {
          const point = character.codePointAt(0);
          return point !== undefined && point > 31 && point !== 127;
        }),
      "Control characters are not allowed",
    ),
  accountId: AccountIdSchema,
  apiKey: z
    .string()
    .min(1)
    .max(16_384)
    .refine((value) => !value.includes("\u0000")),
});
export type ProviderCredentialWriteRequest = z.infer<typeof ProviderCredentialWriteRequestSchema>;

export const ProviderCredentialWriteResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(["CREATED", "ROTATED", "REPLAY"]),
  accountId: AccountIdSchema,
  credentialConfigured: z.literal(true),
  version: z.number().int().positive(),
});
export type ProviderCredentialWriteResponse = z.infer<typeof ProviderCredentialWriteResponseSchema>;
