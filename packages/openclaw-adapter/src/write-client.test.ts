import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { describe, expect, it, vi } from "vitest";
import {
  buildOpenClawWriteClientOptions,
  createOfficialOpenClawWriteGateway,
} from "./write-client.js";

describe("buildOpenClawWriteClientOptions", () => {
  it("pins protocol v4 and requests only operator.write", () => {
    const options = buildOpenClawWriteClientOptions({
      endpoint: "ws://127.0.0.1:18789",
      credential: { kind: "TOKEN", value: "gateway-secret" },
      clientVersion: "0.0.0-test",
      instanceId: "writer-1",
      callbacks: {
        onHello: vi.fn(),
        onClose: vi.fn(),
        onConnectError: vi.fn(),
      },
    });

    expect(options).toMatchObject({
      clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      role: "operator",
      scopes: ["operator.write"],
      caps: [GATEWAY_CLIENT_CAPS.AGENT_KIND],
      commands: [],
      permissions: {},
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      token: "gateway-secret",
    });
    expect(options.scopes).not.toContain("operator.read");
    expect(options.scopes).not.toContain("operator.admin");
  });
});

describe("createOfficialOpenClawWriteGateway", () => {
  it("rejects a shape outside the pinned official chat.send contract", () => {
    const gateway = createOfficialOpenClawWriteGateway({
      endpoint: "ws://127.0.0.1:18789",
      credential: { kind: "TOKEN", value: "gateway-secret" },
      clientVersion: "0.0.0-test",
      instanceId: "writer-1",
      callbacks: {
        onHello: vi.fn(),
        onClose: vi.fn(),
        onConnectError: vi.fn(),
      },
    });

    expect(() =>
      gateway.sendChat({
        sessionKey: "agent:researcher:main",
        agentId: "researcher",
        message: "Verify the protocol.",
        idempotencyKey: "message:1",
        suppressCommandInterpretation: true,
        unknownField: "forbidden",
      } as never),
    ).toThrow("pinned protocol contract");
  });

  it("rejects a shape outside the pinned official agent contract", () => {
    const gateway = createOfficialOpenClawWriteGateway({
      endpoint: "ws://127.0.0.1:18789",
      credential: { kind: "TOKEN", value: "gateway-secret" },
      clientVersion: "0.0.0-test",
      instanceId: "writer-1",
      callbacks: { onHello: vi.fn(), onClose: vi.fn(), onConnectError: vi.fn() },
    });
    expect(() =>
      gateway.runAgent({
        message: "Verify",
        agentId: "researcher",
        sessionKey: "agent:researcher:task",
        idempotencyKey: "run:1",
        label: "Verify",
        deliver: false,
        inputProvenance: {
          kind: "internal_system",
          sourceTool: "agent-world.task-dispatch",
        },
        unknownField: "forbidden",
      } as never),
    ).toThrow("pinned protocol contract");
  });
});
