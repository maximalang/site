import {
  type MemoryGraphProjectionPort,
  type MemoryProjectionEvent,
  MemoryProjectionEventSchema,
} from "@agent-world/domain";

export type GraphitiTool = {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
};

export interface GraphitiToolTransport {
  listTools(): Promise<GraphitiTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean }>;
}

const REQUIRED_ADD_MEMORY_FIELDS = [
  "name",
  "episode_body",
  "group_id",
  "source",
  "source_description",
  "reference_time",
  "uuid",
  "update_communities",
] as const;

function episodeUuid(eventId: string): string {
  return eventId.replace(/^event_/, "");
}

export class GraphitiMemoryAdapter implements MemoryGraphProjectionPort {
  private readiness?: Promise<void>;

  constructor(private readonly transport: GraphitiToolTransport) {}

  private ensureReady(): Promise<void> {
    this.readiness ??= this.transport.listTools().then((tools) => {
      const addMemory = tools.find(({ name }) => name === "add_memory");
      const properties = addMemory?.inputSchema.properties ?? {};
      if (REQUIRED_ADD_MEMORY_FIELDS.some((field) => !(field in properties))) {
        throw new Error("GRAPHITI_ADD_MEMORY_SCHEMA_DRIFT");
      }
    });
    return this.readiness;
  }

  async apply(values: readonly MemoryProjectionEvent[]): Promise<{ appliedThrough: number }> {
    await this.ensureReady();
    const events = values.map((value) => MemoryProjectionEventSchema.parse(value));
    for (let index = 0; index < events.length; index += 1) {
      const previous = events[index - 1];
      const current = events[index];
      if (previous && current && current.sequence <= previous.sequence) {
        throw new Error("GRAPHITI_MEMORY_EVENT_ORDER_INVALID");
      }
    }
    for (const event of events) {
      if (
        event.eventType !== "MEMORY_CURATED" ||
        event.action === "REJECT" ||
        !event.materializedContextItemId ||
        !event.decisionId
      ) {
        continue;
      }
      const result = await this.transport.call("add_memory", {
        name: `AI World memory ${event.proposalId}`,
        episode_body: JSON.stringify({
          schemaVersion: 1,
          canonicalEventId: event.eventId,
          proposalId: event.proposalId,
          decisionId: event.decisionId,
          action: event.action,
          sourceContextItemId: event.sourceContextItemId,
          materializedContextItemId: event.materializedContextItemId,
          content: event.content,
        }),
        group_id: event.projectId,
        source: "json",
        source_description: "AI World canonical curated memory projection",
        reference_time: event.occurredAt,
        uuid: episodeUuid(event.eventId),
        update_communities: false,
      });
      if (result.isError) throw new Error("GRAPHITI_ADD_MEMORY_FAILED");
    }
    return { appliedThrough: events.at(-1)?.sequence ?? 0 };
  }
}
