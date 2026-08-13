import { GatewayClient, type GatewayClientOptions } from "@openclaw/gateway-client";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import * as z from "zod";

const SafeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);
const CredentialValueSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      }),
    "OpenClaw credentials must not contain control characters",
  );
const OpenClawCredentialSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("TOKEN"), value: CredentialValueSchema }),
  z.strictObject({ kind: z.literal("DEVICE_TOKEN"), value: CredentialValueSchema }),
]);

export type OpenClawCredential =
  | { kind: "TOKEN"; value: string }
  | { kind: "DEVICE_TOKEN"; value: string };

export function parseOpenClawCredential(input: unknown): OpenClawCredential {
  return OpenClawCredentialSchema.parse(input);
}

export type OpenClawCloseInfo = {
  phase: "pre-hello" | "post-hello";
  code: number;
};

export type OpenClawReadGatewayCallbacks = {
  onHello: (hello: unknown) => void | Promise<void>;
  onEvent: (event: unknown) => void | Promise<void>;
  onClose: (info: OpenClawCloseInfo) => void | Promise<void>;
  onConnectError: (error: Error) => void | Promise<void>;
  onGap: (info: { expected: number; received: number }) => void | Promise<void>;
};

export type OpenClawSessionsListParams = {
  configuredAgentsOnly: true;
  includeGlobal: false;
  includeUnknown: false;
  limit: 500;
};

export type OpenClawSessionMessageParams = {
  key: string;
  agentId: string;
};

export type OpenClawChatHistoryParams = {
  sessionKey: string;
  agentId: string;
  limit: 200;
  maxChars: 32_000;
};

export interface OpenClawReadGateway {
  start(): void;
  stopAndWait(): Promise<void>;
  subscribeSessions(): Promise<void>;
  subscribeSessionMessages(params: OpenClawSessionMessageParams): Promise<void>;
  readChatHistory(params: OpenClawChatHistoryParams): Promise<unknown>;
  listAgents(): Promise<unknown>;
  listSessions(params: OpenClawSessionsListParams): Promise<unknown>;
  listPresence(): Promise<unknown>;
}

export type OpenClawReadGatewayFactoryInput = {
  endpoint: string;
  credential: OpenClawCredential;
  clientVersion: string;
  instanceId: string;
  callbacks: OpenClawReadGatewayCallbacks;
};

export type OpenClawReadGatewayFactory = (
  input: OpenClawReadGatewayFactoryInput,
) => OpenClawReadGateway;

function invokeCallback(callback: () => void | Promise<void>): void {
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // The adapter owns failure telemetry; transport callbacks must never create
    // an uncaught exception or rejection in the Gateway client's event loop.
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseOpenClawEndpoint(input: unknown): string {
  const endpoint = z.string().trim().min(1).max(2_048).parse(input);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("OpenClaw endpoint must be an absolute WebSocket URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("OpenClaw endpoint must use ws or wss");
  }
  if (url.protocol === "ws:" && !isLoopback(url.hostname)) {
    throw new Error("Plaintext OpenClaw transport is restricted to loopback");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OpenClaw endpoint must not contain credentials or query data");
  }
  return endpoint;
}

export function buildOpenClawReadClientOptions(
  input: OpenClawReadGatewayFactoryInput,
): GatewayClientOptions {
  const endpoint = parseOpenClawEndpoint(input.endpoint);
  const clientVersion = SafeLabelSchema.parse(input.clientVersion);
  const instanceId = SafeLabelSchema.parse(input.instanceId);
  const credential = parseOpenClawCredential(input.credential);

  return {
    url: endpoint,
    clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
    clientVersion,
    instanceId,
    mode: GATEWAY_CLIENT_MODES.BACKEND,
    role: "operator",
    scopes: ["operator.read"],
    caps: [GATEWAY_CLIENT_CAPS.AGENT_KIND],
    commands: [],
    permissions: {},
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    ...(credential.kind === "TOKEN"
      ? { token: credential.value }
      : { deviceToken: credential.value }),
    hostDeps: {
      logDebug: () => undefined,
      logError: () => undefined,
      redactForLog: () => "[redacted]",
    },
    onHelloOk: (hello: HelloOk) => {
      invokeCallback(() => input.callbacks.onHello(hello));
    },
    onEvent: (event: EventFrame) => {
      invokeCallback(() => input.callbacks.onEvent(event));
    },
    onClose: (code, _reason, info) => {
      invokeCallback(() =>
        input.callbacks.onClose({
          code,
          phase: info?.phase ?? "pre-hello",
        }),
      );
    },
    onConnectError: (error) => {
      invokeCallback(() => input.callbacks.onConnectError(error));
    },
    onGap: (info) => {
      invokeCallback(() => input.callbacks.onGap(info));
    },
  };
}

export const createOfficialOpenClawReadGateway: OpenClawReadGatewayFactory = (input) => {
  const client = new GatewayClient(buildOpenClawReadClientOptions(input));
  return {
    start: () => client.start(),
    stopAndWait: () => client.stopAndWait(),
    subscribeSessions: async () => {
      await client.request("sessions.subscribe", {});
    },
    subscribeSessionMessages: async (params) => {
      const response = await client.request("sessions.messages.subscribe", params);
      if (
        response &&
        typeof response === "object" &&
        "key" in response &&
        typeof response.key === "string" &&
        response.key !== params.key
      ) {
        throw new Error("OpenClaw canonicalized a configured Session to a different key");
      }
    },
    readChatHistory: (params) => client.request("chat.history", params),
    listAgents: () => client.request("agents.list", {}),
    listSessions: (params) => client.request("sessions.list", params),
    listPresence: () => client.request("system-presence", {}),
  };
};
