import type { AgentId, EventId, RunId, SessionId, TaskId } from "./index.js";

declare const agentId: AgentId;
declare const eventId: EventId;
declare const taskId: TaskId;
declare const runId: RunId;
declare const sessionId: SessionId;

function acceptsTaskId(_id: TaskId): void {}
function acceptsEventId(_id: EventId): void {}
function acceptsRunId(_id: RunId): void {}

acceptsTaskId(taskId);
acceptsEventId(eventId);
acceptsRunId(runId);

// @ts-expect-error Agent identity cannot be used as Task identity.
acceptsTaskId(agentId);

// @ts-expect-error Task identity cannot be used as Event identity.
acceptsEventId(taskId);

// @ts-expect-error Runtime Session identity cannot be used as canonical Run identity.
acceptsRunId(sessionId);
