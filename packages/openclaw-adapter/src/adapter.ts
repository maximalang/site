import {
  AgentIdSchema,
  BindingIdSchema,
  ConversationIdSchema,
  OpaqueExternalIdSchema,
  SessionIdSchema,
} from "@agent-world/domain";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import * as z from "zod";
import { normalizeOpenClawChatHistory, type OpenClawReceivedMessage } from "./chat-history.js";
import {
  createOfficialOpenClawReadGateway,
  type OpenClawCredential,
  type OpenClawReadGateway,
  type OpenClawReadGatewayCallbacks,
  type OpenClawReadGatewayFactory,
  parseOpenClawCredential,
  parseOpenClawEndpoint,
} from "./client.js";
import {
  createOfflineOpenClawSnapshot,
  normalizeOpenClawSnapshot,
  OpenClawBoundAgentSchema,
  type OpenClawRuntimeSnapshot,
} from "./normalization.js";

export type {
  OpenClawReadGateway,
  OpenClawReadGatewayCallbacks,
  OpenClawReadGatewayFactory,
} from "./client.js";

const SafeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);
const StateVersionSchema = z.object({
  presence: z.number().int().nonnegative(),
  health: z.number().int().nonnegative(),
});
const HelloSchema = z.object({
  protocol: z.number().int(),
  auth: z.object({
    role: z.string(),
    scopes: z.array(z.string()).max(32),
  }),
  snapshot: z.object({
    stateVersion: StateVersionSchema,
  }),
});
const EventSchema = z.object({
  type: z.literal("event"),
  event: SafeLabelSchema,
  payload: z.unknown().optional(),
  seq: z.number().int().nonnegative().optional(),
  stateVersion: StateVersionSchema.optional(),
});
const MessageSessionSchema = z.strictObject({
  conversationId: ConversationIdSchema,
  sessionId: SessionIdSchema,
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  externalAgentId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  externalSessionKey: OpaqueExternalIdSchema,
});
export type OpenClawMessageSession = z.infer<typeof MessageSessionSchema>;
export type OpenClawReceivedHistory = OpenClawMessageSession & {
  messages: OpenClawReceivedMessage[];
};

export type OpenClawAdapterState =
  | "IDLE"
  | "CONNECTING"
  | "SYNCING"
  | "READY"
  | "DEGRADED"
  | "STOPPED";

type OpenClawSyncTrigger = "HELLO" | "EVENT" | "SEQUENCE_GAP";
type OpenClawSyncOutcome =
  | "SUCCEEDED"
  | "INVALID_RESPONSE"
  | "READ_FAILED"
  | "REJECTED_AUTHORITY"
  | "STALE_CONNECTION";

type TelemetryBase = {
  timestamp: string;
  correlationId: string;
};

export type OpenClawTelemetryEvent = TelemetryBase &
  (
    | {
        event: "adapter_state_changed";
        from: OpenClawAdapterState;
        to: OpenClawAdapterState;
      }
    | {
        event: "openclaw_sync_completed";
        trigger: OpenClawSyncTrigger;
        outcome: OpenClawSyncOutcome;
        durationMs: number;
        ignoredUnboundAgentCount?: number;
      }
    | {
        event: "openclaw_event_ignored";
        eventType: string;
        reason: "DUPLICATE_OR_STALE" | "MISSING_SEQUENCE" | "UNSUPPORTED_EVENT" | "MALFORMED";
        sequence?: number;
      }
    | {
        event: "openclaw_sequence_gap";
        expectedSequence: number;
        receivedSequence: number;
      }
    | {
        event: "openclaw_connection_error";
        phase: "CONNECT" | "CLOSE";
        code: "CONNECT_FAILED" | "PRE_HELLO_CLOSE" | "POST_HELLO_CLOSE";
      }
  );

type OpenClawTelemetryPayload = OpenClawTelemetryEvent extends infer Event
  ? Event extends TelemetryBase
    ? Omit<Event, keyof TelemetryBase>
    : never
  : never;

export type OpenClawAdapterSnapshot = {
  runtime: OpenClawRuntimeSnapshot;
  sourceCursor: {
    connectionEpoch: number;
    connectionSequence: number | null;
    stateVersion: Record<string, number>;
  };
};

export type OpenClawReadAdapterOptions = {
  config: {
    endpoint: string;
    clientVersion: string;
    instanceId: string;
  };
  bindings: unknown;
  credentialProvider: () => Promise<OpenClawCredential>;
  gatewayFactory?: OpenClawReadGatewayFactory;
  telemetry: { record: (event: OpenClawTelemetryEvent) => void };
  onSnapshot: (snapshot: OpenClawAdapterSnapshot) => void | Promise<void>;
  messageSessions?: unknown;
  onReceivedHistory?: (history: OpenClawReceivedHistory) => void | Promise<void>;
  now?: () => Date;
  correlationId: string;
};

type PendingSync = {
  trigger: OpenClawSyncTrigger;
  resubscribe: boolean;
};

const SESSION_LIST_PARAMS = {
  configuredAgentsOnly: true,
  includeGlobal: false,
  includeUnknown: false,
  limit: 500,
} as const;
const INVALIDATING_EVENTS = new Set(["agent", "sessions.changed", "presence"]);

export class OpenClawReadAdapter {
  private readonly endpoint: string;
  private readonly clientVersion: string;
  private readonly instanceId: string;
  private readonly bindings: unknown;
  private readonly credentialProvider: () => Promise<OpenClawCredential>;
  private readonly gatewayFactory: OpenClawReadGatewayFactory;
  private readonly telemetry: OpenClawReadAdapterOptions["telemetry"];
  private readonly onSnapshot: OpenClawReadAdapterOptions["onSnapshot"];
  private readonly messageSessions: OpenClawMessageSession[];
  private readonly onReceivedHistory: NonNullable<OpenClawReadAdapterOptions["onReceivedHistory"]>;
  private readonly now: () => Date;
  private readonly correlationId: string;
  private gateway: OpenClawReadGateway | undefined;
  private adapterState: OpenClawAdapterState = "IDLE";
  private connectionEpoch = 0;
  private connectionSequence: number | null = null;
  private stateVersion: Record<string, number> = {};
  private connectionActive = false;
  private syncPromise: Promise<void> | undefined;
  private pendingSync: PendingSync | undefined;
  private snapshotTail: Promise<void> = Promise.resolve();
  private historyTail: Promise<void> = Promise.resolve();

  constructor(options: OpenClawReadAdapterOptions) {
    this.endpoint = parseOpenClawEndpoint(options.config.endpoint);
    this.clientVersion = SafeLabelSchema.parse(options.config.clientVersion);
    this.instanceId = SafeLabelSchema.parse(options.config.instanceId);
    this.bindings = z.array(OpenClawBoundAgentSchema).max(1_000).parse(options.bindings);
    this.credentialProvider = options.credentialProvider;
    this.gatewayFactory = options.gatewayFactory ?? createOfficialOpenClawReadGateway;
    this.telemetry = options.telemetry;
    this.onSnapshot = options.onSnapshot;
    this.messageSessions = z
      .array(MessageSessionSchema)
      .max(100)
      .parse(options.messageSessions ?? []);
    if (this.messageSessions.length > 0 && !options.onReceivedHistory) {
      throw new Error("A runtime history receiver is required for configured message Sessions");
    }
    this.onReceivedHistory = options.onReceivedHistory ?? (async () => undefined);
    this.now = options.now ?? (() => new Date());
    this.correlationId = SafeLabelSchema.parse(options.correlationId);
  }

  get state(): OpenClawAdapterState {
    return this.adapterState;
  }

  async start(): Promise<void> {
    if (this.adapterState !== "IDLE" && this.adapterState !== "STOPPED") {
      return;
    }
    this.setState("CONNECTING");
    try {
      const credential = parseOpenClawCredential(await this.credentialProvider());
      const callbacks: OpenClawReadGatewayCallbacks = {
        onHello: (hello) => this.handleHello(hello),
        onEvent: (event) => this.handleEvent(event),
        onClose: (info) => this.handleClose(info),
        onConnectError: () => this.handleConnectError(),
        // The adapter independently validates sequence order in onEvent. The
        // transport's gap callback is intentionally not a second resync path.
        onGap: () => undefined,
      };
      this.gateway = this.gatewayFactory({
        endpoint: this.endpoint,
        credential,
        clientVersion: this.clientVersion,
        instanceId: this.instanceId,
        callbacks,
      });
      this.gateway.start();
    } catch {
      this.setState("DEGRADED");
      this.record({
        event: "openclaw_connection_error",
        phase: "CONNECT",
        code: "CONNECT_FAILED",
      });
    }
  }

  async stop(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = undefined;
    this.connectionActive = false;
    this.pendingSync = undefined;
    this.setState("STOPPED");
    await gateway?.stopAndWait();
    await this.syncPromise;
    await this.snapshotTail;
    await this.historyTail;
  }

  private async handleHello(input: unknown): Promise<void> {
    const parsed = HelloSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.protocol !== PROTOCOL_VERSION ||
      parsed.data.auth.role !== "operator" ||
      parsed.data.auth.scopes.length !== 1 ||
      parsed.data.auth.scopes[0] !== "operator.read"
    ) {
      this.connectionActive = false;
      this.setState("DEGRADED");
      this.record({
        event: "openclaw_sync_completed",
        trigger: "HELLO",
        outcome: "REJECTED_AUTHORITY",
        durationMs: 0,
      });
      const gateway = this.gateway;
      this.gateway = undefined;
      await gateway?.stopAndWait();
      return;
    }

    this.connectionActive = true;
    this.connectionEpoch += 1;
    this.connectionSequence = null;
    this.stateVersion = { ...parsed.data.snapshot.stateVersion };
    await this.scheduleSync({ trigger: "HELLO", resubscribe: true });
  }

  private async handleEvent(input: unknown): Promise<void> {
    const parsed = EventSchema.safeParse(input);
    if (!parsed.success) {
      this.record({
        event: "openclaw_event_ignored",
        eventType: "malformed",
        reason: "MALFORMED",
      });
      return;
    }

    const event = parsed.data;
    const historySession = this.messageSessionForEvent(event.event, event.payload);
    if (event.seq === undefined) {
      this.record({
        event: "openclaw_event_ignored",
        eventType: event.event,
        reason: "MISSING_SEQUENCE",
      });
      if (INVALIDATING_EVENTS.has(event.event) || historySession) {
        await this.scheduleSync({ trigger: "EVENT", resubscribe: false });
      }
      return;
    }
    if (this.connectionSequence !== null && event.seq <= this.connectionSequence) {
      this.record({
        event: "openclaw_event_ignored",
        eventType: event.event,
        reason: "DUPLICATE_OR_STALE",
        sequence: event.seq,
      });
      return;
    }
    let syncTrigger: OpenClawSyncTrigger = "EVENT";
    if (this.connectionSequence !== null && event.seq > this.connectionSequence + 1) {
      this.record({
        event: "openclaw_sequence_gap",
        expectedSequence: this.connectionSequence + 1,
        receivedSequence: event.seq,
      });
      syncTrigger = "SEQUENCE_GAP";
    }
    this.connectionSequence = event.seq;
    if (event.stateVersion) {
      this.stateVersion = { ...event.stateVersion };
    }
    if (historySession) {
      const startedAt = Date.now();
      try {
        await this.reconcileHistory(historySession);
      } catch {
        this.setState("DEGRADED");
        this.recordSync("EVENT", "READ_FAILED", startedAt);
      }
    }
    if (!INVALIDATING_EVENTS.has(event.event)) {
      if (historySession) {
        if (syncTrigger === "SEQUENCE_GAP") {
          await this.scheduleSync({ trigger: syncTrigger, resubscribe: false });
        }
        return;
      }
      this.record({
        event: "openclaw_event_ignored",
        eventType: event.event,
        reason: "UNSUPPORTED_EVENT",
        sequence: event.seq,
      });
      if (syncTrigger === "SEQUENCE_GAP") {
        await this.scheduleSync({ trigger: syncTrigger, resubscribe: false });
      }
      return;
    }
    await this.scheduleSync({ trigger: syncTrigger, resubscribe: false });
  }

  private handleConnectError(): void {
    this.connectionActive = false;
    this.setState("DEGRADED");
    this.record({
      event: "openclaw_connection_error",
      phase: "CONNECT",
      code: "CONNECT_FAILED",
    });
  }

  private async handleClose(info: {
    phase: "pre-hello" | "post-hello";
    code: number;
  }): Promise<void> {
    if (this.adapterState === "STOPPED") {
      return;
    }
    this.connectionActive = false;
    this.setState("DEGRADED");
    this.record({
      event: "openclaw_connection_error",
      phase: "CLOSE",
      code: info.phase === "post-hello" ? "POST_HELLO_CLOSE" : "PRE_HELLO_CLOSE",
    });
    await this.publishSnapshot({
      runtime: createOfflineOpenClawSnapshot(this.bindings, this.now().toISOString()),
      sourceCursor: this.cursor(),
    });
  }

  private scheduleSync(sync: PendingSync): Promise<void> {
    if (this.syncPromise) {
      this.pendingSync = {
        trigger: sync.trigger,
        resubscribe: sync.resubscribe || (this.pendingSync?.resubscribe ?? false),
      };
      return this.syncPromise;
    }

    this.syncPromise = this.runSyncLoop(sync).finally(() => {
      this.syncPromise = undefined;
    });
    return this.syncPromise;
  }

  private async runSyncLoop(initial: PendingSync): Promise<void> {
    let current: PendingSync | undefined = initial;
    while (current) {
      await this.performSync(current);
      current = this.pendingSync;
      this.pendingSync = undefined;
    }
  }

  private async performSync(sync: PendingSync): Promise<void> {
    const gateway = this.gateway;
    if (!gateway || !this.connectionActive || this.adapterState === "STOPPED") {
      return;
    }
    const startedAt = Date.now();
    const epoch = this.connectionEpoch;
    this.setState("SYNCING");
    try {
      if (sync.resubscribe) {
        await gateway.subscribeSessions();
        for (const session of this.messageSessions) {
          await gateway.subscribeSessionMessages({
            key: session.externalSessionKey,
            agentId: session.externalAgentId,
          });
        }
      }
      const [agents, sessions, presence] = await Promise.all([
        gateway.listAgents(),
        gateway.listSessions(SESSION_LIST_PARAMS),
        gateway.listPresence(),
      ]);
      const runtime = normalizeOpenClawSnapshot({
        bindings: this.bindings,
        receivedAt: this.now().toISOString(),
        agents,
        sessions,
        presence,
      });
      if (epoch !== this.connectionEpoch || !this.connectionActive || this.isStopped()) {
        this.recordSync(sync.trigger, "STALE_CONNECTION", startedAt);
        return;
      }
      await this.publishSnapshot({ runtime, sourceCursor: this.cursor() });
      for (const session of this.messageSessions) {
        await this.reconcileHistory(session);
      }
      if (epoch !== this.connectionEpoch || !this.connectionActive || this.isStopped()) {
        this.recordSync(sync.trigger, "STALE_CONNECTION", startedAt);
        return;
      }
      this.setState("READY");
      this.recordSync(sync.trigger, "SUCCEEDED", startedAt, runtime.ignoredUnboundAgentCount);
    } catch (error) {
      this.setState("DEGRADED");
      this.recordSync(
        sync.trigger,
        error instanceof z.ZodError ? "INVALID_RESPONSE" : "READ_FAILED",
        startedAt,
      );
    }
  }

  private publishSnapshot(snapshot: OpenClawAdapterSnapshot): Promise<void> {
    const current = this.snapshotTail.then(() => this.onSnapshot(snapshot));
    this.snapshotTail = current.catch(() => undefined);
    return current;
  }

  private reconcileHistory(session: OpenClawMessageSession): Promise<void> {
    const current = this.historyTail.then(async () => {
      const gateway = this.gateway;
      if (!gateway || !this.connectionActive || this.isStopped()) return;
      const result = await gateway.readChatHistory({
        sessionKey: session.externalSessionKey,
        agentId: session.externalAgentId,
        limit: 200,
        maxChars: 32_000,
      });
      const messages = normalizeOpenClawChatHistory(result);
      await this.onReceivedHistory({ ...session, messages });
    });
    this.historyTail = current.catch(() => undefined);
    return current;
  }

  private messageSessionForEvent(
    eventType: string,
    payload: unknown,
  ): OpenClawMessageSession | undefined {
    if (eventType !== "chat" && eventType !== "session.message") return undefined;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const record = payload as Record<string, unknown>;
    if (eventType === "chat" && record.state !== "final") return undefined;
    const scope =
      record.scope && typeof record.scope === "object" && !Array.isArray(record.scope)
        ? (record.scope as Record<string, unknown>)
        : undefined;
    const key =
      typeof record.sessionKey === "string"
        ? record.sessionKey
        : typeof record.key === "string"
          ? record.key
          : typeof scope?.sessionKey === "string"
            ? scope.sessionKey
            : undefined;
    const externalAgentId =
      typeof record.agentId === "string"
        ? record.agentId
        : typeof scope?.agentId === "string"
          ? scope.agentId
          : undefined;
    if (!key) return undefined;
    const matches = this.messageSessions.filter(
      (session) =>
        session.externalSessionKey === key &&
        (externalAgentId === undefined || session.externalAgentId === externalAgentId),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private cursor(): OpenClawAdapterSnapshot["sourceCursor"] {
    return {
      connectionEpoch: this.connectionEpoch,
      connectionSequence: this.connectionSequence,
      stateVersion: { ...this.stateVersion },
    };
  }

  private recordSync(
    trigger: OpenClawSyncTrigger,
    outcome: OpenClawSyncOutcome,
    startedAt: number,
    ignoredUnboundAgentCount?: number,
  ): void {
    this.record({
      event: "openclaw_sync_completed",
      trigger,
      outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(ignoredUnboundAgentCount === undefined ? {} : { ignoredUnboundAgentCount }),
    });
  }

  private setState(next: OpenClawAdapterState): void {
    if (this.adapterState === next) {
      return;
    }
    const previous = this.adapterState;
    this.adapterState = next;
    this.record({ event: "adapter_state_changed", from: previous, to: next });
  }

  private isStopped(): boolean {
    return this.adapterState === "STOPPED";
  }

  private record(event: OpenClawTelemetryPayload): void {
    this.telemetry.record({
      ...event,
      timestamp: this.now().toISOString(),
      correlationId: this.correlationId,
    } as OpenClawTelemetryEvent);
  }
}
