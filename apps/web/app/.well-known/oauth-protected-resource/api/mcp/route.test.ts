import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const keys = [
  "AGENT_WORLD_MCP_ENABLED",
  "AGENT_WORLD_MCP_RESOURCE",
  "AGENT_WORLD_MCP_OAUTH_ISSUER",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Native Chat protected-resource metadata", () => {
  it("publishes exact RFC 9728 metadata only when enabled", async () => {
    process.env.AGENT_WORLD_MCP_ENABLED = "true";
    process.env.AGENT_WORLD_MCP_RESOURCE = "https://world.example/api/mcp";
    process.env.AGENT_WORLD_MCP_OAUTH_ISSUER = "https://world.example/oauth";

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "https://world.example/api/mcp",
      authorization_servers: ["https://world.example/oauth"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["ai_world.run.write"],
    });
  });

  it("returns 404 rather than partial metadata when disabled", async () => {
    process.env.AGENT_WORLD_MCP_ENABLED = "false";
    await expect(GET()).resolves.toMatchObject({ status: 404 });
  });
});
