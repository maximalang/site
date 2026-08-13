import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { describe, expect, it, vi } from "vitest";
import { buildOpenClawReadClientOptions, parseOpenClawEndpoint } from "./client.js";

describe("parseOpenClawEndpoint", () => {
  it.each([
    "ws://127.0.0.1:18789",
    "ws://localhost:18789",
    "ws://[::1]:18789",
    "wss://gateway.example.test/openclaw",
  ])("accepts a protected Gateway endpoint: %s", (endpoint) => {
    expect(parseOpenClawEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([
    "ws://gateway.example.test:18789",
    "http://127.0.0.1:18789",
    "wss://user:password@gateway.example.test",
    "wss://gateway.example.test?token=secret",
    "wss://gateway.example.test/#secret",
  ])("rejects a credential-leaking or plaintext remote endpoint: %s", (endpoint) => {
    expect(() => parseOpenClawEndpoint(endpoint)).toThrow();
  });
});

describe("buildOpenClawReadClientOptions", () => {
  it("pins protocol v4 and requests only operator.read", () => {
    const options = buildOpenClawReadClientOptions({
      endpoint: "ws://127.0.0.1:18789",
      credential: { kind: "TOKEN", value: "gateway-secret" },
      clientVersion: "0.0.0-test",
      instanceId: "instance-1",
      callbacks: {
        onHello: vi.fn(),
        onEvent: vi.fn(),
        onClose: vi.fn(),
        onConnectError: vi.fn(),
        onGap: vi.fn(),
      },
    });

    expect(options).toMatchObject({
      clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      role: "operator",
      scopes: ["operator.read"],
      caps: [GATEWAY_CLIENT_CAPS.AGENT_KIND],
      commands: [],
      permissions: {},
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      token: "gateway-secret",
    });
    expect(options).not.toHaveProperty("password");
    expect(options).not.toHaveProperty("bootstrapToken");
    expect(options.scopes).not.toContain("operator.write");
    expect(options.scopes).not.toContain("operator.admin");
  });

  it("places a paired device token only in the deviceToken field", () => {
    const options = buildOpenClawReadClientOptions({
      endpoint: "wss://gateway.example.test",
      credential: { kind: "DEVICE_TOKEN", value: "paired-device-secret" },
      clientVersion: "0.0.0-test",
      instanceId: "instance-1",
      callbacks: {
        onHello: vi.fn(),
        onEvent: vi.fn(),
        onClose: vi.fn(),
        onConnectError: vi.fn(),
        onGap: vi.fn(),
      },
    });

    expect(options.deviceToken).toBe("paired-device-secret");
    expect(options).not.toHaveProperty("token");
    expect(options.hostDeps?.logDebug).toBeTypeOf("function");
    expect(options.hostDeps?.logError).toBeTypeOf("function");
  });

  it.each([
    { kind: "PASSWORD", value: "secret" },
    { kind: "TOKEN", value: "secret\nlog-injection" },
  ])("rejects unsupported or unsafe credential material", (credential) => {
    expect(() =>
      buildOpenClawReadClientOptions({
        endpoint: "ws://127.0.0.1:18789",
        credential: credential as never,
        clientVersion: "0.0.0-test",
        instanceId: "instance-1",
        callbacks: {
          onHello: vi.fn(),
          onEvent: vi.fn(),
          onClose: vi.fn(),
          onConnectError: vi.fn(),
          onGap: vi.fn(),
        },
      }),
    ).toThrow();
  });
});
