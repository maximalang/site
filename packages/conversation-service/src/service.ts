import {
  ConversationMessageSchema,
  ConversationSchema,
  type ConversationSession,
  ConversationSessionSchema,
  type Conversation as DomainConversation,
  type ExecutionAdapterKind,
  type MessageId,
  OpaqueExternalIdSchema,
  type OwnerConversationMessage,
  type RuntimeBinding,
  RuntimeBindingSchema,
  type SendMessageIntent,
  SendMessageIntentSchema,
  type SessionId,
  TimestampSchema,
} from "@agent-world/domain";
import * as z from "zod";

export type PrepareSendRejectionCode =
  | "CONVERSATION_NOT_FOUND"
  | "AGENT_MISMATCH"
  | "NO_ACTIVE_SESSION"
  | "IDEMPOTENCY_CONFLICT";

export type PrepareSendResult =
  | {
      kind: "READY";
      conversation: DomainConversation;
      session: ConversationSession;
      binding: RuntimeBinding;
      message: OwnerConversationMessage;
    }
  | { kind: "REPLAY"; message: OwnerConversationMessage }
  | { kind: "REJECTED"; code: PrepareSendRejectionCode };

export const DeliveryReceiptSchema = z.strictObject({
  acceptedAt: TimestampSchema,
  externalRequestId: OpaqueExternalIdSchema.optional(),
});
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

export type PrepareSendInput = {
  intent: SendMessageIntent;
  acceptedAt: string;
};

export type MarkDispatchedInput = {
  messageId: MessageId;
  sessionId: SessionId;
  dispatchedAt: string;
  receipt: DeliveryReceipt;
};

export type MarkFailedInput = {
  messageId: MessageId;
  sessionId: SessionId;
  failedAt: string;
  failureCode: "ADAPTER_UNAVAILABLE" | "ADAPTER_REJECTED";
};

/**
 * `prepareSend` must be atomic. It claims the idempotency key, verifies the
 * canonical conversation/Agent pair, selects one active runtime session and
 * persists the owner message before returning READY. A completed duplicate is
 * REPLAY; a duplicate with different immutable input is IDEMPOTENCY_CONFLICT.
 */
export interface ConversationCommandStore {
  prepareSend(input: PrepareSendInput): Promise<PrepareSendResult>;
  markDispatched(input: MarkDispatchedInput): Promise<unknown>;
  markFailed(input: MarkFailedInput): Promise<unknown>;
}

export type ConversationDeliveryInput = {
  messageId: MessageId;
  conversationId: SendMessageIntent["conversationId"];
  agentId: SendMessageIntent["agentId"];
  bindingId: ConversationSession["bindingId"];
  externalAgentId: RuntimeBinding["externalAgentId"];
  externalSessionRef: ConversationSession["externalSessionRef"];
  content: string;
  idempotencyKey: SendMessageIntent["idempotencyKey"];
};

/** Delivery implementations must deduplicate retries by `idempotencyKey`. */
export interface ConversationDeliveryAdapter {
  readonly kind: ExecutionAdapterKind;
  deliver(input: ConversationDeliveryInput): Promise<unknown>;
}

export interface ConversationDeliveryAdapterRegistry {
  resolve(kind: ExecutionAdapterKind): ConversationDeliveryAdapter | undefined;
}

export type ConversationSendErrorCode =
  | "INVALID_INTENT"
  | PrepareSendRejectionCode
  | "PERSISTENCE_FAILED"
  | "DELIVERY_UNAVAILABLE"
  | "DELIVERY_FAILED";

const ERROR_MESSAGES: Record<ConversationSendErrorCode, string> = {
  INVALID_INTENT: "The message intent is invalid.",
  CONVERSATION_NOT_FOUND: "The conversation does not exist.",
  AGENT_MISMATCH: "The conversation does not belong to the selected Agent.",
  NO_ACTIVE_SESSION: "The conversation has no active runtime session.",
  IDEMPOTENCY_CONFLICT: "The idempotency key belongs to a different message.",
  PERSISTENCE_FAILED: "The conversation state could not be persisted safely.",
  DELIVERY_UNAVAILABLE: "The selected runtime delivery adapter is unavailable.",
  DELIVERY_FAILED: "The runtime did not accept the message.",
};

export class ConversationSendError extends Error {
  readonly code: ConversationSendErrorCode;

  constructor(code: ConversationSendErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ConversationSendError";
    this.code = code;
  }
}

const CONVERSATION_SEND_ERROR_CODES = new Set<ConversationSendErrorCode>([
  "INVALID_INTENT",
  "CONVERSATION_NOT_FOUND",
  "AGENT_MISMATCH",
  "NO_ACTIVE_SESSION",
  "IDEMPOTENCY_CONFLICT",
  "PERSISTENCE_FAILED",
  "DELIVERY_UNAVAILABLE",
  "DELIVERY_FAILED",
]);

export function isConversationSendError(
  input: unknown,
): input is { name: "ConversationSendError"; code: ConversationSendErrorCode } {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const candidate = input as { name?: unknown; code?: unknown };
  return (
    candidate.name === "ConversationSendError" &&
    typeof candidate.code === "string" &&
    CONVERSATION_SEND_ERROR_CODES.has(candidate.code as ConversationSendErrorCode)
  );
}

export type ConversationSendResult = {
  outcome: "DISPATCHED" | "REPLAYED";
  message: OwnerConversationMessage;
};

export type ConversationSendServiceOptions = {
  store: ConversationCommandStore;
  adapters: ConversationDeliveryAdapterRegistry;
  now?: () => Date;
};

export class ConversationSendService {
  private readonly store: ConversationCommandStore;
  private readonly adapters: ConversationDeliveryAdapterRegistry;
  private readonly now: () => Date;

  constructor(options: ConversationSendServiceOptions) {
    this.store = options.store;
    this.adapters = options.adapters;
    this.now = options.now ?? (() => new Date());
  }

  async send(input: unknown): Promise<ConversationSendResult> {
    const parsedIntent = SendMessageIntentSchema.safeParse(input);
    if (!parsedIntent.success) {
      throw new ConversationSendError("INVALID_INTENT");
    }
    const intent = parsedIntent.data;
    const operationAt = this.safeNow();
    const prepared = await this.prepare(intent, operationAt);

    if (prepared.kind === "REJECTED") {
      throw new ConversationSendError(prepared.code);
    }
    if (prepared.kind === "REPLAY") {
      const replay = this.validOwnerMessage(prepared.message, intent, "DISPATCHED");
      if (!replay) {
        throw new ConversationSendError("PERSISTENCE_FAILED");
      }
      return { outcome: "REPLAYED", message: replay };
    }

    const ready = this.validReady(prepared, intent);
    if (!ready) {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
    const adapter = this.resolveAdapter(ready.session.adapterKind);
    if (!adapter || adapter.kind !== ready.session.adapterKind) {
      await this.fail(ready.message, operationAt, "ADAPTER_UNAVAILABLE");
      throw new ConversationSendError("DELIVERY_UNAVAILABLE");
    }

    let receipt: DeliveryReceipt;
    try {
      receipt = DeliveryReceiptSchema.parse(
        await adapter.deliver({
          messageId: intent.id,
          conversationId: intent.conversationId,
          agentId: intent.agentId,
          bindingId: ready.session.bindingId,
          externalAgentId: ready.binding.externalAgentId,
          externalSessionRef: ready.session.externalSessionRef,
          content: intent.content,
          idempotencyKey: intent.idempotencyKey,
        }),
      );
    } catch {
      await this.fail(ready.message, operationAt, "ADAPTER_REJECTED");
      throw new ConversationSendError("DELIVERY_FAILED");
    }

    let persisted: unknown;
    try {
      persisted = await this.store.markDispatched({
        messageId: intent.id,
        sessionId: ready.session.id,
        dispatchedAt: operationAt,
        receipt,
      });
    } catch {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
    const message = this.validOwnerMessage(persisted, intent, "DISPATCHED", ready.session.id);
    if (!message) {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
    return { outcome: "DISPATCHED", message };
  }

  private safeNow(): string {
    try {
      return TimestampSchema.parse(this.now().toISOString());
    } catch {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
  }

  private async prepare(intent: SendMessageIntent, acceptedAt: string): Promise<PrepareSendResult> {
    try {
      const result = await this.store.prepareSend({ intent, acceptedAt });
      if (
        result.kind === "READY" ||
        result.kind === "REPLAY" ||
        (result.kind === "REJECTED" &&
          [
            "CONVERSATION_NOT_FOUND",
            "AGENT_MISMATCH",
            "NO_ACTIVE_SESSION",
            "IDEMPOTENCY_CONFLICT",
          ].includes(result.code))
      ) {
        return result;
      }
    } catch {
      // Store and driver errors are deliberately collapsed below.
    }
    throw new ConversationSendError("PERSISTENCE_FAILED");
  }

  private validReady(
    prepared: Extract<PrepareSendResult, { kind: "READY" }>,
    intent: SendMessageIntent,
  ):
    | {
        conversation: DomainConversation;
        session: ConversationSession;
        binding: RuntimeBinding;
        message: OwnerConversationMessage;
      }
    | undefined {
    const parsedConversation = ConversationSchema.safeParse(prepared.conversation);
    const parsedSession = ConversationSessionSchema.safeParse(prepared.session);
    const parsedBinding = RuntimeBindingSchema.safeParse(prepared.binding);
    const message = this.validOwnerMessage(prepared.message, intent, undefined);
    if (
      !parsedConversation.success ||
      !parsedSession.success ||
      !parsedBinding.success ||
      !message
    ) {
      return undefined;
    }
    const conversation = parsedConversation.data;
    const session = parsedSession.data;
    const binding = parsedBinding.data;
    if (
      conversation.id !== intent.conversationId ||
      conversation.agentId !== intent.agentId ||
      session.endedAt !== undefined ||
      session.conversationId !== intent.conversationId ||
      session.agentId !== intent.agentId ||
      binding.id !== session.bindingId ||
      binding.agentId !== intent.agentId ||
      binding.adapterKind !== session.adapterKind ||
      !binding.isEnabled ||
      message.sessionId !== session.id ||
      (message.delivery !== "ACCEPTED" && message.delivery !== "FAILED")
    ) {
      return undefined;
    }
    return { conversation, session, binding, message };
  }

  private validOwnerMessage(
    input: unknown,
    intent: SendMessageIntent,
    delivery?: OwnerConversationMessage["delivery"],
    sessionId?: SessionId,
  ): OwnerConversationMessage | undefined {
    const parsed = ConversationMessageSchema.safeParse(input);
    if (!parsed.success || parsed.data.author !== "OWNER") {
      return undefined;
    }
    const message = parsed.data;
    if (
      message.id !== intent.id ||
      message.conversationId !== intent.conversationId ||
      message.agentId !== intent.agentId ||
      message.content !== intent.content ||
      message.source.commandId !== intent.idempotencyKey ||
      (delivery !== undefined && message.delivery !== delivery) ||
      (sessionId !== undefined && message.sessionId !== sessionId)
    ) {
      return undefined;
    }
    return message;
  }

  private resolveAdapter(kind: ExecutionAdapterKind): ConversationDeliveryAdapter | undefined {
    try {
      return this.adapters.resolve(kind);
    } catch {
      return undefined;
    }
  }

  private async fail(
    message: OwnerConversationMessage,
    failedAt: string,
    failureCode: MarkFailedInput["failureCode"],
  ): Promise<void> {
    let persisted: unknown;
    try {
      persisted = await this.store.markFailed({
        messageId: message.id,
        sessionId: message.sessionId,
        failedAt,
        failureCode,
      });
    } catch {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
    const parsed = ConversationMessageSchema.safeParse(persisted);
    if (
      !parsed.success ||
      parsed.data.author !== "OWNER" ||
      parsed.data.id !== message.id ||
      parsed.data.conversationId !== message.conversationId ||
      parsed.data.sessionId !== message.sessionId ||
      parsed.data.agentId !== message.agentId ||
      parsed.data.content !== message.content ||
      parsed.data.createdAt !== message.createdAt ||
      parsed.data.source.commandId !== message.source.commandId ||
      parsed.data.delivery !== "FAILED"
    ) {
      throw new ConversationSendError("PERSISTENCE_FAILED");
    }
  }
}
