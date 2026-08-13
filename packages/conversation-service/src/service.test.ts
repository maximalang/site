import {
  AgentIdSchema,
  ConversationMessageSchema,
  ConversationSchema,
  ConversationSessionSchema,
  type OwnerConversationMessage,
  RuntimeBindingSchema,
  SendMessageIntentSchema,
} from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type ConversationCommandStore,
  type ConversationDeliveryAdapter,
  ConversationSendError,
  ConversationSendService,
  isConversationSendError,
  type PrepareSendResult,
} from "./index.js";

const IDS = {
  agent: "agent_11111111-1111-1111-1111-111111111111",
  binding: "binding_22222222-2222-2222-2222-222222222222",
  conversation: "conversation_33333333-3333-3333-3333-333333333333",
  message: "message_44444444-4444-4444-4444-444444444444",
  project: "project_55555555-5555-5555-5555-555555555555",
  route: "route_77777777-7777-7777-7777-777777777777",
  session: "session_66666666-6666-6666-6666-666666666666",
} as const;

const intent = SendMessageIntentSchema.parse({
  schemaVersion: 1,
  id: IDS.message,
  conversationId: IDS.conversation,
  agentId: IDS.agent,
  content: "Verify the protocol.",
  idempotencyKey: "message:44444444-4444-4444-4444-444444444444",
  createdAt: "2026-08-13T10:00:00.000Z",
});
const conversation = ConversationSchema.parse({
  schemaVersion: 1,
  id: IDS.conversation,
  agentId: IDS.agent,
  projectId: IDS.project,
  createdAt: "2026-08-13T09:00:00.000Z",
});
const session = ConversationSessionSchema.parse({
  schemaVersion: 1,
  id: IDS.session,
  conversationId: IDS.conversation,
  agentId: IDS.agent,
  bindingId: IDS.binding,
  adapterKind: "OPENCLAW",
  externalSessionRef: "agent:researcher:protocol",
  startedAt: "2026-08-13T09:30:00.000Z",
});
const binding = RuntimeBindingSchema.parse({
  schemaVersion: 1,
  id: IDS.binding,
  agentId: IDS.agent,
  routeId: IDS.route,
  adapterKind: "OPENCLAW",
  externalAgentId: "researcher",
  isEnabled: true,
});

function ownerMessage(delivery: OwnerConversationMessage["delivery"]): OwnerConversationMessage {
  return ConversationMessageSchema.parse({
    schemaVersion: 1,
    id: IDS.message,
    conversationId: IDS.conversation,
    sessionId: IDS.session,
    agentId: IDS.agent,
    author: "OWNER",
    content: intent.content,
    delivery,
    createdAt: intent.createdAt,
    source: {
      kind: "DOMAIN",
      actor: "OWNER",
      commandId: intent.idempotencyKey,
    },
  }) as OwnerConversationMessage;
}

function setup(prepareResult: PrepareSendResult) {
  const store: ConversationCommandStore = {
    prepareSend: vi.fn(async () => prepareResult),
    markDispatched: vi.fn(async () => ownerMessage("DISPATCHED")),
    markFailed: vi.fn(async () => ownerMessage("FAILED")),
  };
  const adapter: ConversationDeliveryAdapter = {
    kind: "OPENCLAW",
    deliver: vi.fn(async () => ({ acceptedAt: "2026-08-13T10:00:01.000Z" })),
  };
  const service = new ConversationSendService({
    store,
    adapters: { resolve: (kind) => (kind === "OPENCLAW" ? adapter : undefined) },
    now: () => new Date("2026-08-13T10:00:01.000Z"),
  });
  return { adapter, service, store };
}

describe("ConversationSendService", () => {
  it("recognizes bounded send errors across a production bundle boundary", () => {
    expect(
      isConversationSendError({
        name: "ConversationSendError",
        code: "CONVERSATION_NOT_FOUND",
        message: "must-not-be-reflected",
      }),
    ).toBe(true);
    expect(
      isConversationSendError({ name: "ConversationSendError", code: "DATABASE_SECRET" }),
    ).toBe(false);
    expect(isConversationSendError(new Error("provider-secret"))).toBe(false);
  });
  it("persists a stable session before delivering the bounded intent", async () => {
    const accepted = ownerMessage("ACCEPTED");
    const { adapter, service, store } = setup({
      kind: "READY",
      conversation,
      session,
      binding,
      message: accepted,
    });

    const result = await service.send(intent);

    expect(store.prepareSend).toHaveBeenCalledWith({
      intent,
      acceptedAt: "2026-08-13T10:00:01.000Z",
    });
    expect(adapter.deliver).toHaveBeenCalledWith({
      messageId: intent.id,
      conversationId: intent.conversationId,
      agentId: intent.agentId,
      bindingId: session.bindingId,
      externalAgentId: binding.externalAgentId,
      externalSessionRef: session.externalSessionRef,
      content: intent.content,
      idempotencyKey: intent.idempotencyKey,
    });
    expect(store.markDispatched).toHaveBeenCalledWith({
      messageId: intent.id,
      sessionId: session.id,
      dispatchedAt: "2026-08-13T10:00:01.000Z",
      receipt: { acceptedAt: "2026-08-13T10:00:01.000Z" },
    });
    expect(result).toEqual({ outcome: "DISPATCHED", message: ownerMessage("DISPATCHED") });
  });

  it("returns a completed idempotent replay without another runtime call", async () => {
    const dispatched = ownerMessage("DISPATCHED");
    const { adapter, service, store } = setup({ kind: "REPLAY", message: dispatched });

    await expect(service.send(intent)).resolves.toEqual({
      outcome: "REPLAYED",
      message: dispatched,
    });
    expect(adapter.deliver).not.toHaveBeenCalled();
    expect(store.markDispatched).not.toHaveBeenCalled();
  });

  it("replays a later retry while preserving the first persisted timestamp", async () => {
    const dispatched = ownerMessage("DISPATCHED");
    const { adapter, service } = setup({ kind: "REPLAY", message: dispatched });

    await expect(
      service.send({ ...intent, createdAt: "2026-08-13T10:05:00.000Z" }),
    ).resolves.toEqual({ outcome: "REPLAYED", message: dispatched });
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it.each([
    "CONVERSATION_NOT_FOUND",
    "AGENT_MISMATCH",
    "NO_ACTIVE_SESSION",
    "IDEMPOTENCY_CONFLICT",
  ] as const)("fails closed for repository rejection %s", async (code) => {
    const { adapter, service } = setup({ kind: "REJECTED", code });

    await expect(service.send(intent)).rejects.toMatchObject({ code });
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it("rejects inconsistent repository data before contacting a runtime", async () => {
    const { adapter, service } = setup({
      kind: "READY",
      conversation,
      session: {
        ...session,
        agentId: AgentIdSchema.parse("agent_77777777-7777-7777-7777-777777777777"),
      },
      binding,
      message: ownerMessage("ACCEPTED"),
    });

    await expect(service.send(intent)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it("rejects a runtime binding owned by a different Agent", async () => {
    const { adapter, service } = setup({
      kind: "READY",
      conversation,
      session,
      binding: {
        ...binding,
        agentId: AgentIdSchema.parse("agent_88888888-8888-8888-8888-888888888888"),
      },
      message: ownerMessage("ACCEPTED"),
    });

    await expect(service.send(intent)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it("records a bounded failure and never leaks an adapter error", async () => {
    const { adapter, service, store } = setup({
      kind: "READY",
      conversation,
      session,
      binding,
      message: ownerMessage("ACCEPTED"),
    });
    vi.mocked(adapter.deliver).mockRejectedValueOnce(new Error("secret gateway response"));

    const failure = await service.send(intent).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConversationSendError);
    expect(failure).toMatchObject({ code: "DELIVERY_FAILED" });
    expect(String(failure)).not.toContain("secret gateway response");
    expect(store.markFailed).toHaveBeenCalledWith({
      messageId: intent.id,
      sessionId: session.id,
      failedAt: "2026-08-13T10:00:01.000Z",
      failureCode: "ADAPTER_REJECTED",
    });
  });

  it("records an unavailable adapter without attempting delivery", async () => {
    const { adapter, store } = setup({
      kind: "READY",
      conversation,
      session,
      binding,
      message: ownerMessage("ACCEPTED"),
    });
    const service = new ConversationSendService({
      store,
      adapters: { resolve: () => undefined },
      now: () => new Date("2026-08-13T10:00:01.000Z"),
    });

    await expect(service.send(intent)).rejects.toMatchObject({ code: "DELIVERY_UNAVAILABLE" });
    expect(adapter.deliver).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith({
      messageId: intent.id,
      sessionId: session.id,
      failedAt: "2026-08-13T10:00:01.000Z",
      failureCode: "ADAPTER_UNAVAILABLE",
    });
  });

  it("validates unknown input before any persistence call", async () => {
    const { service, store } = setup({ kind: "REJECTED", code: "CONVERSATION_NOT_FOUND" });

    await expect(
      service.send({ ...intent, externalSessionRef: "forbidden" }),
    ).rejects.toMatchObject({
      code: "INVALID_INTENT",
    });
    expect(store.prepareSend).not.toHaveBeenCalled();
  });
});
