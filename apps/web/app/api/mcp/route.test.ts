import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const original = {
  enabled: process.env.AGENT_WORLD_MCP_ENABLED,
  issuer: process.env.AGENT_WORLD_MCP_OAUTH_ISSUER,
  resource: process.env.AGENT_WORLD_MCP_RESOURCE,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    AGENT_WORLD_MCP_ENABLED: original.enabled,
    AGENT_WORLD_MCP_OAUTH_ISSUER: original.issuer,
    AGENT_WORLD_MCP_RESOURCE: original.resource,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("/api/mcp fail-closed route", () => {
  it("is undiscoverable unless the complete MCP OAuth configuration is enabled", async () => {
    delete process.env.AGENT_WORLD_MCP_ENABLED;
    delete process.env.AGENT_WORLD_MCP_OAUTH_ISSUER;
    delete process.env.AGENT_WORLD_MCP_RESOURCE;

    await expect(GET()).resolves.toMatchObject({ status: 404 });
    await expect(
      POST(new Request("https://world.example/api/mcp", { method: "POST" })),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("rejects incomplete or non-HTTPS configuration", async () => {
    process.env.AGENT_WORLD_MCP_ENABLED = "true";
    process.env.AGENT_WORLD_MCP_RESOURCE = "http://world.example/api/mcp";
    process.env.AGENT_WORLD_MCP_OAUTH_ISSUER = "https://world.example/oauth";
    await expect(GET()).resolves.toMatchObject({ status: 404 });
  });
});
