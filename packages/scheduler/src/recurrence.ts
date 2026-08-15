import { CronExpressionParser } from "cron-parser";
import * as z from "zod";

const RecurrenceInputSchema = z.strictObject({
  expression: z.string().trim().min(9).max(128),
  timezone: z.string().trim().min(1).max(100),
  after: z.iso.datetime(),
});

export function nextOccurrence(input: unknown): string {
  const recurrence = RecurrenceInputSchema.parse(input);
  if (recurrence.expression.split(/\s+/u).length !== 5) {
    throw new Error("Agent schedules require a five-field cron expression");
  }
  const next = CronExpressionParser.parse(recurrence.expression, {
    currentDate: recurrence.after,
    tz: recurrence.timezone,
  })
    .next()
    .toDate();
  if (!Number.isFinite(next.getTime()) || next.getTime() <= Date.parse(recurrence.after)) {
    throw new Error("Cron expression did not produce a future occurrence");
  }
  return next.toISOString();
}
