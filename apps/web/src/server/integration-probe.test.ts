import { createHash, generateKeyPairSync } from "node:crypto";
import { Server, utils } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import {
  createNodeIntegrationAction,
  createNodeIntegrationMutationExecutor,
  createNodeIntegrationProbe,
  type ProbeTarget,
} from "./integration-probe";

const target = {
  id: "integration_11111111-1111-4111-8111-111111111111",
  kind: "MCP",
  label: "Remote MCP",
  endpoint: { transport: "HTTPS", url: "https://unapproved.example/api/mcp" },
  health: "UNCONFIGURED",
  isEnabled: true,
  hasCredential: false,
  credentialRef: null,
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
} as ProbeTarget;

describe("integration protocol probe", () => {
  it("fails closed before DNS or network access when a host is not allowlisted", async () => {
    const result = await createNodeIntegrationProbe({
      allowedHosts: [],
      allowPrivateNetwork: false,
    })(target);
    expect(result).toEqual({ health: "ERROR", code: "HOST_NOT_ALLOWLISTED" });
  });

  it("never probes a disabled Integration", async () => {
    const result = await createNodeIntegrationProbe({
      allowedHosts: ["unapproved.example"],
      allowPrivateNetwork: true,
    })({ ...target, isEnabled: false });
    expect(result).toEqual({ health: "ERROR", code: "INTEGRATION_DISABLED" });
  });

  it("requires an explicit acknowledgement for allowlisted private addresses", async () => {
    const result = await createNodeIntegrationProbe({
      allowedHosts: ["127.0.0.1"],
      allowPrivateNetwork: false,
    })({ ...target, endpoint: { transport: "HTTPS", url: "https://127.0.0.1/api/mcp" } });
    expect(result).toEqual({ health: "ERROR", code: "PRIVATE_NETWORK_NOT_ACKNOWLEDGED" });
  });
});

describe("predefined integration actions", () => {
  it("fails closed before network access when the target host is not allowlisted", async () => {
    const result = await createNodeIntegrationAction({
      allowedHosts: [],
      allowPrivateNetwork: false,
    })({ ...target, health: "READY" }, "MCP_LIST_TOOLS");
    expect(result).toEqual({
      status: "FAILED",
      items: [{ id: "error", label: "HOST_NOT_ALLOWLISTED" }],
    });
  });

  it("rejects an action whose kind does not match the canonical Integration", async () => {
    const result = await createNodeIntegrationAction({
      allowedHosts: ["unapproved.example"],
      allowPrivateNetwork: true,
    })({ ...target, health: "READY" }, "GITHUB_LIST_REPOSITORIES");
    expect(result.status).toBe("FAILED");
    expect(result.items[0]?.label).toBe("INTEGRATION_ACTION_KIND_MISMATCH");
  });

  it("completes the MCP lifecycle before returning normalized tools", async () => {
    const https = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", result: {} }),
        contentType: "application/json",
        sessionId: "session-1",
      })
      .mockResolvedValueOnce({ status: 202, body: "", contentType: "" })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          result: { tools: [{ name: "search", description: "Public search" }] },
        }),
        contentType: "application/json",
      });
    const result = await createNodeIntegrationAction(
      { allowedHosts: ["unapproved.example"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "203.0.113.10", family: 4 }),
        https,
      },
    )({ ...target, health: "READY" }, "MCP_LIST_TOOLS", "token");
    expect(result).toEqual({
      status: "SUCCEEDED",
      items: [{ id: "search", label: "search", detail: "Public search" }],
    });
    expect(https).toHaveBeenCalledTimes(3);
    expect(https.mock.calls[1]?.[4]).toMatchObject({ "mcp-session-id": "session-1" });
    expect(https.mock.calls[1]?.[5]).toContain("notifications/initialized");
  });

  it("preserves a numeric GitHub repository id as bounded text", async () => {
    const github = {
      ...target,
      kind: "GITHUB",
      endpoint: { transport: "HTTPS", url: "https://api.github.com" },
      health: "READY",
    } as ProbeTarget;
    const result = await createNodeIntegrationAction(
      { allowedHosts: ["api.github.com"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "140.82.112.6", family: 4 }),
        https: vi.fn().mockResolvedValue({
          status: 200,
          body: JSON.stringify([{ id: 42, full_name: "owner/repo", private: true }]),
          contentType: "application/json",
        }),
      },
    )(github, "GITHUB_LIST_REPOSITORIES", "token");
    expect(result.items).toEqual([{ id: "42", label: "owner/repo", detail: "private · active" }]);
  });
});

describe("approved integration mutations", () => {
  const mutation = {
    kind: "GITHUB_DISPATCH_WORKFLOW" as const,
    owner: "maximalang",
    repository: "site",
    workflowId: "deploy.yml",
    ref: "main",
  };

  it("dispatches only the canonical GitHub workflow endpoint", async () => {
    const https = vi.fn().mockResolvedValue({ status: 204, body: "", contentType: "" });
    const result = await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["api.github.com"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "140.82.112.6", family: 4 }),
        https,
      },
    )({ endpointUrl: "https://api.github.com/ignored", credential: "token", mutation });
    expect(result).toEqual({ state: "SUCCEEDED" });
    expect(https.mock.calls[0]?.[0].toString()).toBe(
      "https://api.github.com/repos/maximalang/site/actions/workflows/deploy.yml/dispatches",
    );
    expect(JSON.parse(https.mock.calls[0]?.[5])).toEqual({
      ref: "main",
      return_run_details: true,
    });
  });

  it("calls an approved MCP tool with only its registry-owned fixed arguments", async () => {
    const https = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: "initialize", result: {} }),
        contentType: "application/json",
        sessionId: "session-1",
      })
      .mockResolvedValueOnce({ status: 202, body: "", contentType: "" })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: "tool-call", result: { content: [] } }),
        contentType: "application/json",
      });
    const result = await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["mcp.example"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "203.0.113.10", family: 4 }),
        https,
      },
    )({
      endpointUrl: "https://mcp.example/mcp",
      credential: "token",
      mutation: {
        kind: "MCP_CALL_REGISTERED_TOOL",
        toolName: "artifact.publish",
        fixedArguments: { channel: "review" },
      },
    });
    expect(result).toEqual({ state: "SUCCEEDED" });
    expect(https).toHaveBeenCalledTimes(3);
    expect(JSON.parse(https.mock.calls[2]?.[5])).toEqual({
      jsonrpc: "2.0",
      id: "tool-call",
      method: "tools/call",
      params: { name: "artifact.publish", arguments: { channel: "review" } },
    });
    expect(https.mock.calls[2]?.[4]).toEqual(
      expect.objectContaining({ "mcp-session-id": "session-1" }),
    );
  });

  it("derives a registered SSH service command and pins the trusted host key", async () => {
    const ssh = vi.fn().mockResolvedValue({ code: 0 });
    const result = await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["vds.example"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "203.0.113.20", family: 4 }),
        ssh,
      },
    )({
      endpoint: { transport: "SSH", host: "vds.example", port: 22, username: "deploy" },
      credential: "private-key",
      mutation: {
        kind: "SSH_RUN_REGISTERED_OPERATION",
        operation: { kind: "SYSTEMD_RESTART", systemdUnit: "agent-world.service" },
        hostKeySha256: `SHA256:${"A".repeat(43)}`,
      },
    });
    expect(result).toEqual({ state: "SUCCEEDED" });
    expect(ssh).toHaveBeenCalledWith({
      address: "203.0.113.20",
      port: 22,
      username: "deploy",
      privateKey: "private-key",
      hostKeySha256: `SHA256:${"A".repeat(43)}`,
      command: "sudo -n systemctl restart -- agent-world.service",
    });
  });

  it("derives a bounded Compose deploy and never accepts a caller command", async () => {
    const ssh = vi.fn().mockResolvedValue({ code: 0 });
    await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["vds.example"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "203.0.113.20", family: 4 }),
        ssh,
      },
    )({
      endpoint: { transport: "SSH", host: "vds.example", port: 22, username: "deploy" },
      credential: "private-key",
      mutation: {
        kind: "SSH_RUN_REGISTERED_OPERATION",
        operation: {
          kind: "DOCKER_COMPOSE_DEPLOY",
          composeProject: "agent-world",
          workingDirectory: "/srv/agent-world",
        },
        hostKeySha256: `SHA256:${"B".repeat(43)}`,
      },
    });
    expect(ssh.mock.calls[0]?.[0].command).toBe(
      "cd -- /srv/agent-world && docker compose --project-name agent-world pull && docker compose --project-name agent-world up -d --remove-orphans",
    );
  });

  it("executes the derived command through a real SSH handshake with host-key pinning", async () => {
    const serverPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      format: "pem",
      type: "pkcs1",
    });
    const clientPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      format: "pem",
      type: "pkcs1",
    });
    const parsed = utils.parseKey(serverPrivateKey);
    if (parsed instanceof Error) throw parsed;
    const hostKeySha256 = `SHA256:${createHash("sha256")
      .update(parsed.getPublicSSH())
      .digest("base64")
      .replace(/=+$/, "")}`;
    let receivedCommand = "";
    const server = new Server({ hostKeys: [serverPrivateKey] }, (client) => {
      client.on("authentication", (context) => context.accept());
      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec, _reject, info) => {
            receivedCommand = info.command;
            const stream = acceptExec();
            stream.exit(0);
            stream.end();
          });
        });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("SSH test server unavailable");
    try {
      const result = await createNodeIntegrationMutationExecutor(
        { allowedHosts: ["vds.example"], allowPrivateNetwork: true },
        { resolve: vi.fn().mockResolvedValue({ address: "127.0.0.1", family: 4 }) },
      )({
        endpoint: {
          transport: "SSH",
          host: "vds.example",
          port: address.port,
          username: "deploy",
        },
        credential: clientPrivateKey.toString(),
        mutation: {
          kind: "SSH_RUN_REGISTERED_OPERATION",
          operation: { kind: "SYSTEMD_RESTART", systemdUnit: "agent-world.service" },
          hostKeySha256,
        },
      });
      expect(result).toEqual({ state: "SUCCEEDED" });
      expect(receivedCommand).toBe("sudo -n systemctl restart -- agent-world.service");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);

  it("does not retry a transport failure with an unknown remote outcome", async () => {
    const https = vi.fn().mockRejectedValue(new Error("socket reset"));
    const result = await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["api.github.com"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "140.82.112.6", family: 4 }),
        https,
      },
    )({ endpointUrl: "https://api.github.com", credential: "token", mutation });
    expect(result).toEqual({
      state: "OUTCOME_UNKNOWN",
      failureCode: "INTERRUPTED_OUTCOME_UNKNOWN",
    });
    expect(https).toHaveBeenCalledOnce();
  });

  it("treats a server error as outcome-unknown instead of safe-to-retry", async () => {
    const result = await createNodeIntegrationMutationExecutor(
      { allowedHosts: ["api.github.com"], allowPrivateNetwork: false },
      {
        resolve: vi.fn().mockResolvedValue({ address: "140.82.112.6", family: 4 }),
        https: vi.fn().mockResolvedValue({ status: 503, body: "", contentType: "" }),
      },
    )({ endpointUrl: "https://api.github.com", credential: "token", mutation });
    expect(result).toEqual({
      state: "OUTCOME_UNKNOWN",
      failureCode: "REMOTE_OUTCOME_UNKNOWN",
    });
  });
});
