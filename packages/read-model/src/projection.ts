import {
  type Agent,
  AgentSchema,
  AgentStatusSchema,
  type ProjectionCursor,
  ProjectionCursorSchema,
  type TaskIntent,
  TaskIntentSchema,
  type WorldEvent,
  WorldEventSchema,
} from "@agent-world/domain";
import * as z from "zod";

const MAX_AGENTS = 500;
const MAX_TASKS = 2_000;
const MAX_EVENTS = 100_000;
const TimestampSchema = z.iso.datetime();
function safeDisplayText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint > 31 && codePoint !== 127;
        }),
      "Display text must not contain control characters",
    );
}

export const WorldReadModelSourceSchema = z.enum(["LIVE", "CONTRACT_FIXTURE", "UNAVAILABLE"]);
export type WorldReadModelSource = z.infer<typeof WorldReadModelSourceSchema>;

export const WorldZoneSchema = z.enum(["AGENT_HALL", "WORK_ROOM", "REVIEW_ROOM", "CONTROL_TOWER"]);
export type WorldZone = z.infer<typeof WorldZoneSchema>;

const TaskApprovalProjectionSchema = z.enum([
  "REQUIRED",
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "DENIED",
  "REVOKED",
]);

export const ReadModelTaskSchema = z.strictObject({
  taskId: TaskIntentSchema.shape.id,
  title: safeDisplayText(200),
  assigneeAgentId: AgentSchema.shape.id,
  approval: TaskApprovalProjectionSchema,
});
export type ReadModelTask = z.infer<typeof ReadModelTaskSchema>;

export const AgentProjectionCoreSchema = z.strictObject({
  agentId: AgentSchema.shape.id,
  displayName: safeDisplayText(100),
  role: safeDisplayText(160),
  isEnabled: z.boolean(),
  status: AgentStatusSchema,
  currentTask: ReadModelTaskSchema.omit({ assigneeAgentId: true }).optional(),
});
export type AgentProjectionCore = z.infer<typeof AgentProjectionCoreSchema>;

export const WorldPlacementSchema = z.strictObject({
  zone: WorldZoneSchema,
  slot: z.strictObject({
    column: z.number().int().nonnegative().max(9),
    row: z.number().int().nonnegative().max(124),
  }),
});
export type WorldPlacement = z.infer<typeof WorldPlacementSchema>;

export const WorldReadModelAgentSchema = z.strictObject({
  ...AgentProjectionCoreSchema.shape,
  world: WorldPlacementSchema,
});
export type WorldReadModelAgent = z.infer<typeof WorldReadModelAgentSchema>;

export const WorldReadModelSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: WorldReadModelSourceSchema,
    generatedAt: TimestampSchema,
    cursor: ProjectionCursorSchema,
    agents: z.array(WorldReadModelAgentSchema).max(MAX_AGENTS),
    tasks: z.array(ReadModelTaskSchema).max(MAX_TASKS),
  })
  .refine(
    (model) =>
      model.source !== "UNAVAILABLE" ||
      (model.agents.length === 0 && model.tasks.length === 0 && model.cursor.lastSequence === 0),
    "Unavailable read models must be empty and use the initial cursor",
  );
export type WorldReadModel = z.infer<typeof WorldReadModelSchema>;

export const WorldViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: WorldReadModelSourceSchema,
  generatedAt: TimestampSchema,
  cursor: ProjectionCursorSchema,
  agents: z.array(
    z.strictObject({
      core: AgentProjectionCoreSchema,
      world: WorldPlacementSchema,
    }),
  ),
});
export type WorldView = z.infer<typeof WorldViewSchema>;

export const CommandViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: WorldReadModelSourceSchema,
  generatedAt: TimestampSchema,
  cursor: ProjectionCursorSchema,
  agents: z.array(z.strictObject({ core: AgentProjectionCoreSchema })),
});
export type CommandView = z.infer<typeof CommandViewSchema>;

type BuildWorldReadModelInput = {
  source: "LIVE" | "CONTRACT_FIXTURE";
  generatedAt: unknown;
  agents: unknown;
  tasks: unknown;
  events: unknown;
};

const LiveRuntimeAgentStatusSchema = z.strictObject({
  agentId: AgentSchema.shape.id,
  status: AgentStatusSchema,
});

export type BuildLiveRuntimeWorldReadModelInput = {
  generatedAt: unknown;
  cursor: unknown;
  agents: unknown;
  runtimeStatuses: unknown;
};

function assertUnique<T>(values: T[], identity: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = identity(value);
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label}: ${id}`);
    }
    seen.add(id);
  }
}

function assertContiguousEvents(events: WorldEvent[]): void {
  events.forEach((event, index) => {
    const expected = index + 1;
    if (event.sequence !== expected) {
      throw new Error(
        `World event sequence must be contiguous from 1; expected ${expected}, received ${event.sequence}`,
      );
    }
  });
}

function initialTaskApproval(task: TaskIntent): ReadModelTask["approval"] {
  return task.approvalRequirement === "NOT_REQUIRED" ? "NOT_REQUIRED" : "REQUIRED";
}

function zoneForStatus(status: AgentProjectionCore["status"]): WorldZone {
  switch (status) {
    case "QUEUED":
    case "RUNNING":
      return "WORK_ROOM";
    case "WAITING_APPROVAL":
      return "REVIEW_ROOM";
    case "BLOCKED":
    case "FAILED":
      return "CONTROL_TOWER";
    case "IDLE":
    case "OFFLINE":
      return "AGENT_HALL";
  }
}

function cursorFromEvents(events: WorldEvent[]): ProjectionCursor {
  const latest = events.at(-1);
  return ProjectionCursorSchema.parse(
    latest
      ? {
          schemaVersion: 1,
          stream: "WORLD",
          lastSequence: latest.sequence,
          lastEventId: latest.id,
        }
      : { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
  );
}

export function buildWorldReadModel(input: BuildWorldReadModelInput): WorldReadModel {
  const generatedAt = TimestampSchema.parse(input.generatedAt);
  const agents = z.array(AgentSchema).max(MAX_AGENTS).parse(input.agents);
  const tasks = z.array(TaskIntentSchema).max(MAX_TASKS).parse(input.tasks);
  const events = z.array(WorldEventSchema).max(MAX_EVENTS).parse(input.events);
  assertUnique(agents, (agent) => agent.id, "Agent");
  assertUnique(tasks, (task) => task.id, "Task");
  assertUnique(events, (event) => event.id, "World event");
  assertContiguousEvents(events);

  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const));
  const approvalByTaskId = new Map(
    tasks.map((task) => [task.id, initialTaskApproval(task)] as const),
  );
  const statusByAgentId = new Map<Agent["id"], AgentProjectionCore["status"]>(
    agents.map((agent) => [agent.id, "OFFLINE"] as const),
  );
  const currentTaskByAgentId = new Map<string, TaskIntent>();

  for (const event of events) {
    switch (event.eventType) {
      case "TASK_ASSIGNED": {
        const task = tasksById.get(event.payload.taskId);
        if (!task) {
          throw new Error(`Task assignment references unknown Task: ${event.payload.taskId}`);
        }
        if (!agentsById.has(event.payload.agentId)) {
          throw new Error(`Task assignment references unknown Agent: ${event.payload.agentId}`);
        }
        if (task.assigneeAgentId !== event.payload.agentId) {
          throw new Error(`Task assignment contradicts canonical Task assignee: ${task.id}`);
        }
        currentTaskByAgentId.set(event.payload.agentId, task);
        break;
      }
      case "AGENT_STATUS_CHANGED": {
        if (!agentsById.has(event.payload.agentId)) {
          throw new Error(`Status event references unknown Agent: ${event.payload.agentId}`);
        }
        if (event.payload.taskId) {
          const task = tasksById.get(event.payload.taskId);
          if (!task) {
            throw new Error(`Status event references unknown Task: ${event.payload.taskId}`);
          }
          if (task.assigneeAgentId !== event.payload.agentId) {
            throw new Error(`Status event contradicts canonical Task assignee: ${task.id}`);
          }
        }
        statusByAgentId.set(event.payload.agentId, event.payload.status);
        break;
      }
      case "APPROVAL_STATE_CHANGED": {
        if (!tasksById.has(event.payload.taskId)) {
          throw new Error(`Approval event references unknown Task: ${event.payload.taskId}`);
        }
        approvalByTaskId.set(event.payload.taskId, event.payload.state.type);
        break;
      }
    }
  }

  const readTasks = tasks
    .map(
      (task): ReadModelTask => ({
        taskId: task.id,
        title: task.title,
        assigneeAgentId: task.assigneeAgentId,
        approval: approvalByTaskId.get(task.id) ?? initialTaskApproval(task),
      }),
    )
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  const readTasksById = new Map(readTasks.map((task) => [task.taskId, task] as const));
  const zoneCounts = new Map<WorldZone, number>();
  const readAgents = [...agents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((agent): WorldReadModelAgent => {
      const status = AgentStatusSchema.parse(statusByAgentId.get(agent.id) ?? "OFFLINE");
      const task = currentTaskByAgentId.get(agent.id);
      const readTask = task ? readTasksById.get(task.id) : undefined;
      const zone = zoneForStatus(status);
      const zoneIndex = zoneCounts.get(zone) ?? 0;
      zoneCounts.set(zone, zoneIndex + 1);
      return {
        agentId: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        isEnabled: agent.isEnabled,
        status,
        ...(readTask
          ? {
              currentTask: {
                taskId: readTask.taskId,
                title: readTask.title,
                approval: readTask.approval,
              },
            }
          : {}),
        world: {
          zone,
          slot: { column: zoneIndex % 4, row: Math.floor(zoneIndex / 4) },
        },
      };
    });

  return WorldReadModelSchema.parse({
    schemaVersion: 1,
    source: input.source,
    generatedAt,
    cursor: cursorFromEvents(events),
    agents: readAgents,
    tasks: readTasks,
  });
}

export function buildUnavailableWorldReadModel(generatedAtInput: unknown): WorldReadModel {
  return WorldReadModelSchema.parse({
    schemaVersion: 1,
    source: "UNAVAILABLE",
    generatedAt: TimestampSchema.parse(generatedAtInput),
    cursor: { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
    agents: [],
    tasks: [],
  });
}

export function buildLiveRuntimeWorldReadModel(
  input: BuildLiveRuntimeWorldReadModelInput,
): WorldReadModel {
  const generatedAt = TimestampSchema.parse(input.generatedAt);
  const cursor = ProjectionCursorSchema.parse(input.cursor);
  const agents = z.array(AgentSchema).max(MAX_AGENTS).parse(input.agents);
  const runtimeStatuses = z
    .array(LiveRuntimeAgentStatusSchema)
    .max(MAX_AGENTS)
    .parse(input.runtimeStatuses);
  assertUnique(agents, ({ id }) => id, "Agent");
  assertUnique(runtimeStatuses, ({ agentId }) => agentId, "runtime Agent status");
  const canonicalIds = new Set(agents.map(({ id }) => id));
  for (const status of runtimeStatuses) {
    if (!canonicalIds.has(status.agentId)) {
      throw new Error(`Runtime status references unknown Agent: ${status.agentId}`);
    }
  }
  const statuses = new Map(
    runtimeStatuses.map(({ agentId, status }) => [agentId, status] as const),
  );
  const zoneCounts = new Map<WorldZone, number>();
  const readAgents = [...agents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((agent): WorldReadModelAgent => {
      const status = statuses.get(agent.id) ?? AgentStatusSchema.parse("OFFLINE");
      const zone = zoneForStatus(status);
      const zoneIndex = zoneCounts.get(zone) ?? 0;
      zoneCounts.set(zone, zoneIndex + 1);
      return {
        agentId: agent.id,
        displayName: agent.displayName,
        role: agent.role,
        isEnabled: agent.isEnabled,
        status,
        world: {
          zone,
          slot: { column: zoneIndex % 4, row: Math.floor(zoneIndex / 4) },
        },
      };
    });

  return WorldReadModelSchema.parse({
    schemaVersion: 1,
    source: "LIVE",
    generatedAt,
    cursor,
    agents: readAgents,
    tasks: [],
  });
}

function coreFromAgent(agent: WorldReadModelAgent): AgentProjectionCore {
  return AgentProjectionCoreSchema.parse({
    agentId: agent.agentId,
    displayName: agent.displayName,
    role: agent.role,
    isEnabled: agent.isEnabled,
    status: agent.status,
    ...(agent.currentTask ? { currentTask: agent.currentTask } : {}),
  });
}

export function projectWorldView(input: unknown): WorldView {
  const model = WorldReadModelSchema.parse(input);
  return WorldViewSchema.parse({
    schemaVersion: 1,
    source: model.source,
    generatedAt: model.generatedAt,
    cursor: model.cursor,
    agents: model.agents.map((agent) => ({ core: coreFromAgent(agent), world: agent.world })),
  });
}

export function projectCommandView(input: unknown): CommandView {
  const model = WorldReadModelSchema.parse(input);
  return CommandViewSchema.parse({
    schemaVersion: 1,
    source: model.source,
    generatedAt: model.generatedAt,
    cursor: model.cursor,
    agents: model.agents.map((agent) => ({ core: coreFromAgent(agent) })),
  });
}
