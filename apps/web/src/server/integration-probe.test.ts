import { describe, expect, it } from "vitest";
import { createNodeIntegrationProbe, type ProbeTarget } from "./integration-probe";

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
