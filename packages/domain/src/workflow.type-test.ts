import type { AgentId, EventId, TaskId } from "./index.js";

declare const agentId: AgentId;
declare const eventId: EventId;
declare const taskId: TaskId;

function acceptsTaskId(_id: TaskId): void {}
function acceptsEventId(_id: EventId): void {}

acceptsTaskId(taskId);
acceptsEventId(eventId);

// @ts-expect-error Agent identity cannot be used as Task identity.
acceptsTaskId(agentId);

// @ts-expect-error Task identity cannot be used as Event identity.
acceptsEventId(taskId);
