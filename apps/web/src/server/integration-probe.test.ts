import { describe, expect, it, vi } from "vitest";
import {
  createNodeIntegrationAction,
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
