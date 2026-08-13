import type {
  ConversationDeliveryAdapter,
  ConversationDeliveryInput,
  DeliveryReceipt,
} from "@agent-world/conversation-service";
import {
  AgentIdSchema,
  BindingIdSchema,
  ConversationIdSchema,
  IdempotencyKeySchema,
  MessageContentSchema,
  MessageIdSchema,
  OpaqueExternalIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
} from "@agent-world/domain";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import * as z from "zod";
import { parseOpenClawCredential, parseOpenClawEndpoint } from "./client.js";
import {
  createOfficialOpenClawWriteGateway,
  type OpenClawWriteGateway,
  type OpenClawWriteGatewayCallbacks,
  type OpenClawWriteGatewayFactory,
} from "./write-client.js";

export type {
  OpenClawWriteGateway,
  OpenClawWriteGatewayCallbacks,
  OpenClawWriteGatewayFactory,
} from "./write-client.js";

const SafeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);
const HelloSchema = z.object({
  protocol: z.number().int(),
  auth: z.object({
    role: z.string(),
    scopes: z.array(z.string()).max(32),
  }),
});
const DeliveryInputSchema = z.strictObject({
  messageId: MessageIdSchema,
  conversationId: ConversationIdSchema,
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  externalAgentId: OpaqueExternalIdSchema,
  externalSessionRef: OpaqueExternalIdSchema,
  content: MessageContentSchema,
  idempotencyKey: IdempotencyKeySchema,
});
const SendResultSchema = z.object({
  runId: OpaqueExternalIdSchema.optional(),
});
const TaskExecutionInputSchema = z.strictObject({
  runId: RunIdSchema,
  taskId: TaskIdSchema,
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  sessionId: SessionIdSchema,
  externalAgentId: OpaqueExternalIdSchema,
  externalSessionRef: OpaqueExternalIdSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20_000).optional(),
  idempotencyKey: IdempotencyKeySchema,
});
const AgentRunResultSchema = z.object({ runId: OpaqueExternalIdSchema });

export type OpenClawTaskExecutionInput = z.infer<typeof TaskExecutionInputSchema>;
export type OpenClawTaskExecutionReceipt = { acceptedAt: string; externalRunId: string };

export type OpenClawWriteAdapterState = "IDLE" | "CONNECTING" | "READY" | "DEGRADED" | "STOPPED";

type TelemetryBase = {
  timestamp: string;
  correlationId: string;
};

export type OpenClawWriteTelemetryEvent = TelemetryBase &
  (
    | {
        event: "write_adapter_state_changed";
        from: OpenClawWriteAdapterState;
        to: OpenClawWriteAdapterState;
      }
    | {
        event: "openclaw_write_authority_checked";
        outcome: "ACCEPTED" | "REJECTED";
      }
    | {
        event: "openclaw_write_connection_error";
        phase: "CONNECT" | "CLOSE";
        code: "CONNECT_FAILED" | "PRE_HELLO_CLOSE" | "POST_HELLO_CLOSE";
      }
    | {
        event: "openclaw_chat_send_completed";
        outcome: "ACCEPTED" | "REJECTED" | "INVALID_RESPONSE";
        durationMs: number;
      }
    | {
        event: "openclaw_task_dispatch_completed";
        outcome: "ACCEPTED" | "REJECTED" | "INVALID_RESPONSE";
        durationMs: number;
      }
  );

type OpenClawWriteTelemetryPayload = OpenClawWriteTelemetryEvent extends infer Event
  ? Event extends TelemetryBase
    ? Omit<Event, keyof TelemetryBase>
    : never
  : never;

export type OpenClawWriteAdapterOptions = {
  config: {
    endpoint: string;
    clientVersion: string;
    instanceId: string;
  };
  credentialProvider: () => Promise<unknown>;
  gatewayFactory?: OpenClawWriteGatewayFactory;
  telemetry: { record: (event: OpenClawWriteTelemetryEvent) => void };
  now?: () => Date;
  correlationId: string;
};

export class OpenClawWriteAdapter implements ConversationDeliveryAdapter {
  readonly kind = "OPENCLAW" as const;
  private readonly endpoint: string;
  private readonly clientVersion: string;
  private readonly instanceId: string;
  private readonly credentialProvider: OpenClawWriteAdapterOptions["credentialProvider"];
  private readonly gatewayFactory: OpenClawWriteGatewayFactory;
  private readonly telemetry: OpenClawWriteAdapterOptions["telemetry"];
  private readonly now: () => Date;
  private readonly correlationId: string;
  private gateway: OpenClawWriteGateway | undefined;
  private adapterState: OpenClawWriteAdapterState = "IDLE";
  private connectionEpoch = 0;
  private readinessEpoch = 0;

  constructor(options: OpenClawWriteAdapterOptions) {
    this.endpoint = parseOpenClawEndpoint(options.config.endpoint);
    this.clientVersion = SafeLabelSchema.parse(options.config.clientVersion);
    this.instanceId = SafeLabelSchema.parse(options.config.instanceId);
    this.credentialProvider = options.credentialProvider;
    this.gatewayFactory = options.gatewayFactory ?? createOfficialOpenClawWriteGateway;
    this.telemetry = options.telemetry;
    this.now = options.now ?? (() => new Date());
    this.correlationId = SafeLabelSchema.parse(options.correlationId);
  }

  get state(): OpenClawWriteAdapterState {
    return this.adapterState;
  }

  async start(): Promise<void> {
    if (this.adapterState !== "IDLE" && this.adapterState !== "STOPPED") {
      return;
    }
    this.setState("CONNECTING");
    this.connectionEpoch += 1;
    const epoch = this.connectionEpoch;
    try {
      const credential = parseOpenClawCredential(await this.credentialProvider());
      if (epoch !== this.connectionEpoch) {
        return;
      }
      const callbacks: OpenClawWriteGatewayCallbacks = {
        onHello: (hello) => this.handleHello(hello, epoch),
        onClose: (info) => this.handleClose(info, epoch),
        onConnectError: () => this.handleConnectError(epoch),
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
      if (epoch !== this.connectionEpoch) {
        return;
      }
      this.gateway = undefined;
      this.setState("DEGRADED");
      this.record({
        event: "openclaw_write_connection_error",
        phase: "CONNECT",
        code: "CONNECT_FAILED",
      });
    }
  }

  async stop(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = undefined;
    this.connectionEpoch += 1;
    this.readinessEpoch += 1;
    this.setState("STOPPED");
    await gateway?.stopAndWait();
  }

  async deliver(input: ConversationDeliveryInput): Promise<DeliveryReceipt> {
    const parsed = DeliveryInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error("OpenClaw delivery input is invalid");
    }
    const gateway = this.gateway;
    if (this.adapterState !== "READY" || !gateway) {
      throw new Error("OpenClaw write adapter is not ready");
    }
    const startedAt = Date.now();
    const deliveryEpoch = this.readinessEpoch;
    let response: unknown;
    try {
      response = await gateway.sendChat({
        sessionKey: parsed.data.externalSessionRef,
        agentId: parsed.data.externalAgentId,
        message: parsed.data.content,
        idempotencyKey: parsed.data.idempotencyKey,
        suppressCommandInterpretation: true,
      });
    } catch {
      this.recordSend("REJECTED", startedAt);
      throw new Error("OpenClaw rejected the chat send request");
    }
    const sendResult = SendResultSchema.safeParse(response);
    if (
      !sendResult.success ||
      deliveryEpoch !== this.readinessEpoch ||
      this.adapterState !== "READY" ||
      gateway !== this.gateway
    ) {
      this.recordSend("INVALID_RESPONSE", startedAt);
      throw new Error("OpenClaw returned an invalid or stale chat send response");
    }
    this.recordSend("ACCEPTED", startedAt);
    return {
      acceptedAt: this.now().toISOString(),
      ...(sendResult.data.runId === undefined ? {} : { externalRequestId: sendResult.data.runId }),
    };
  }

  async executeTask(input: OpenClawTaskExecutionInput): Promise<OpenClawTaskExecutionReceipt> {
    const parsed = TaskExecutionInputSchema.safeParse(input);
    if (!parsed.success) throw new Error("OpenClaw Task execution input is invalid");
    const gateway = this.gateway;
    if (this.adapterState !== "READY" || !gateway) {
      throw new Error("OpenClaw write adapter is not ready");
    }
    const startedAt = Date.now();
    const deliveryEpoch = this.readinessEpoch;
    let response: unknown;
    try {
      response = await gateway.runAgent({
        message: parsed.data.description
          ? `${parsed.data.title}\n\n${parsed.data.description}`
          : parsed.data.title,
        agentId: parsed.data.externalAgentId,
        sessionKey: parsed.data.externalSessionRef,
        idempotencyKey: parsed.data.idempotencyKey,
        label: parsed.data.title,
        deliver: false,
        inputProvenance: {
          kind: "internal_system",
          sourceTool: "agent-world.task-dispatch",
        },
      });
    } catch {
      this.recordTaskDispatch("REJECTED", startedAt);
      throw new Error("OpenClaw rejected the Task execution request");
    }
    const result = AgentRunResultSchema.safeParse(response);
    if (
      !result.success ||
      deliveryEpoch !== this.readinessEpoch ||
      this.adapterState !== "READY" ||
      gateway !== this.gateway
    ) {
      this.recordTaskDispatch("INVALID_RESPONSE", startedAt);
      throw new Error("OpenClaw returned an invalid or stale Task execution response");
    }
    this.recordTaskDispatch("ACCEPTED", startedAt);
    return { acceptedAt: this.now().toISOString(), externalRunId: result.data.runId };
  }

  private async handleHello(input: unknown, epoch: number): Promise<void> {
    if (epoch !== this.connectionEpoch || !this.gateway || this.adapterState === "STOPPED") {
      return;
    }
    const parsed = HelloSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.protocol !== PROTOCOL_VERSION ||
      parsed.data.auth.role !== "operator" ||
      parsed.data.auth.scopes.length !== 1 ||
      parsed.data.auth.scopes[0] !== "operator.write"
    ) {
      this.setState("DEGRADED");
      this.record({ event: "openclaw_write_authority_checked", outcome: "REJECTED" });
      const gateway = this.gateway;
      this.gateway = undefined;
      this.connectionEpoch += 1;
      this.readinessEpoch += 1;
      await gateway?.stopAndWait();
      return;
    }
    this.readinessEpoch += 1;
    this.setState("READY");
    this.record({ event: "openclaw_write_authority_checked", outcome: "ACCEPTED" });
  }

  private handleConnectError(epoch: number): void {
    if (epoch !== this.connectionEpoch || this.adapterState === "STOPPED") {
      return;
    }
    this.readinessEpoch += 1;
    this.setState("DEGRADED");
    this.record({
      event: "openclaw_write_connection_error",
      phase: "CONNECT",
      code: "CONNECT_FAILED",
    });
  }

  private handleClose(
    info: { phase: "pre-hello" | "post-hello"; code: number },
    epoch: number,
  ): void {
    if (epoch !== this.connectionEpoch || this.adapterState === "STOPPED") {
      return;
    }
    this.readinessEpoch += 1;
    this.setState("DEGRADED");
    this.record({
      event: "openclaw_write_connection_error",
      phase: "CLOSE",
      code: info.phase === "post-hello" ? "POST_HELLO_CLOSE" : "PRE_HELLO_CLOSE",
    });
  }

  private recordSend(
    outcome: "ACCEPTED" | "REJECTED" | "INVALID_RESPONSE",
    startedAt: number,
  ): void {
    this.record({
      event: "openclaw_chat_send_completed",
      outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  }

  private recordTaskDispatch(
    outcome: "ACCEPTED" | "REJECTED" | "INVALID_RESPONSE",
    startedAt: number,
  ): void {
    this.record({
      event: "openclaw_task_dispatch_completed",
      outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
  }

  private setState(next: OpenClawWriteAdapterState): void {
    if (this.adapterState === next) {
      return;
    }
    const previous = this.adapterState;
    this.adapterState = next;
    this.record({ event: "write_adapter_state_changed", from: previous, to: next });
  }

  private record(event: OpenClawWriteTelemetryPayload): void {
    this.telemetry.record({
      ...event,
      timestamp: this.now().toISOString(),
      correlationId: this.correlationId,
    } as OpenClawWriteTelemetryEvent);
  }
}
