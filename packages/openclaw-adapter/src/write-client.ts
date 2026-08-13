import { GatewayClient, type GatewayClientOptions } from "@openclaw/gateway-client";
import { validateChatSendParams } from "@openclaw/gateway-protocol";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import * as z from "zod";
import {
  type OpenClawCloseInfo,
  type OpenClawCredential,
  parseOpenClawCredential,
  parseOpenClawEndpoint,
} from "./client.js";

const SafeLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);

export type OpenClawChatSendParams = {
  sessionKey: string;
  agentId: string;
  message: string;
  idempotencyKey: string;
  suppressCommandInterpretation: true;
};

export type OpenClawWriteGatewayCallbacks = {
  onHello: (hello: unknown) => void | Promise<void>;
  onClose: (info: OpenClawCloseInfo) => void | Promise<void>;
  onConnectError: (error: Error) => void | Promise<void>;
};

export interface OpenClawWriteGateway {
  start(): void;
  stopAndWait(): Promise<void>;
  sendChat(params: OpenClawChatSendParams): Promise<unknown>;
}

export type OpenClawWriteGatewayFactoryInput = {
  endpoint: string;
  credential: OpenClawCredential;
  clientVersion: string;
  instanceId: string;
  callbacks: OpenClawWriteGatewayCallbacks;
};

export type OpenClawWriteGatewayFactory = (
  input: OpenClawWriteGatewayFactoryInput,
) => OpenClawWriteGateway;

function invokeCallback(callback: () => void | Promise<void>): void {
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // The adapter owns bounded failure telemetry. Never reject from the
    // official client's callback loop or expose provider errors there.
  }
}

export function buildOpenClawWriteClientOptions(
  input: OpenClawWriteGatewayFactoryInput,
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
    scopes: ["operator.write"],
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
    onHelloOk: (hello) => {
      invokeCallback(() => input.callbacks.onHello(hello));
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
  };
}

export const createOfficialOpenClawWriteGateway: OpenClawWriteGatewayFactory = (input) => {
  const client = new GatewayClient(buildOpenClawWriteClientOptions(input));
  return {
    start: () => client.start(),
    stopAndWait: () => client.stopAndWait(),
    sendChat: (params) => {
      if (!validateChatSendParams(params)) {
        throw new Error("OpenClaw chat.send parameters violate the pinned protocol contract");
      }
      return client.request("chat.send", params);
    },
  };
};
