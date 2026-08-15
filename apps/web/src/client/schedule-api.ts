import { type AgentSchedule, AgentScheduleSchema } from "@agent-world/domain";
import * as z from "zod";

const ScheduleListSchema = z.strictObject({
  schemaVersion: z.literal(1),
  schedules: z.array(AgentScheduleSchema).max(250),
});
const ScheduleCreateResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  schedule: z.strictObject({
    outcome: z.enum(["CREATED", "REPLAY"]),
    schedule: AgentScheduleSchema,
  }),
});

export type CreateScheduleInput = Omit<
  AgentSchedule,
  "schemaVersion" | "nextFireAt" | "createdAt" | "updatedAt"
>;
type ScheduleFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadSchedules(fetcher: ScheduleFetch = fetch): Promise<AgentSchedule[]> {
  const response = await fetcher("/api/schedules?limit=100", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Schedules are unavailable");
  const parsed = ScheduleListSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid schedule list");
  return parsed.data.schedules;
}

export async function createSchedule(
  input: CreateScheduleInput,
  csrfToken: string,
  fetcher: ScheduleFetch = fetch,
): Promise<AgentSchedule> {
  const response = await fetcher("/api/schedules", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Schedule was not created");
  const parsed = ScheduleCreateResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid schedule response");
  return parsed.data.schedule.schedule;
}
