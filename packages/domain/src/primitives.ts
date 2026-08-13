import * as z from "zod";

export const TimestampSchema = z.iso.datetime();

const OperationKeySchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z][a-z0-9._-]{0,31}:[A-Za-z0-9._:-]+$/);

export const CommandIdSchema = OperationKeySchema;
export type CommandId = z.infer<typeof CommandIdSchema>;

export const IdempotencyKeySchema = OperationKeySchema;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
