import { describe, expect, it, vi } from "vitest";
import { HttpGraphitiMcpTransport } from "./http-mcp-transport.js";

describe("HttpGraphitiMcpTransport", () => {
  it("initializes one Streamable HTTP session and calls tools without credentials in URLs", async () => {
    const responses = [
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } },
      ),
      new Response(null, { status: 202 }),
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { tools: [{ name: "add_memory", inputSchema: { properties: {} } }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [], isError: false } })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    ];
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        responses.shift() ?? new Response(null, { status: 500 }),
    );
    const transport = new HttpGraphitiMcpTransport({
      endpoint: "http://graphiti:8000/mcp/",
      plaintextPrivateNetworkAck: "private-network",
      fetcher,
    });
    expect(await transport.listTools()).toHaveLength(1);
    expect(await transport.call("add_memory", { episode_body: "{}" })).toEqual({ isError: false });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({ "mcp-session-id": "s1" });
  });

  it("rejects credential-bearing endpoints and unacknowledged plaintext", () => {
    expect(() => new HttpGraphitiMcpTransport({ endpoint: "http://graphiti:8000/mcp/" })).toThrow();
    expect(
      () =>
        new HttpGraphitiMcpTransport({
          endpoint: "https://user:secret@example.com/mcp/",
        }),
    ).toThrow();
  });
});
