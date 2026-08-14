import type { GraphitiTool, GraphitiToolTransport } from "./memory-adapter.js";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GRAPHITI_MCP_RESPONSE_INVALID");
  }
  return value as Record<string, unknown>;
}

function parseSse(text: string): JsonRpcResponse {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (payloads.length === 0) throw new Error("GRAPHITI_MCP_SSE_EMPTY");
  return record(JSON.parse(payloads.at(-1) ?? "")) as JsonRpcResponse;
}

function endpoint(value: string, acknowledgement?: string): URL {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("GRAPHITI_MCP_URL_CREDENTIALS_FORBIDDEN");
  if (!url.pathname.endsWith("/mcp/") && !url.pathname.endsWith("/mcp")) {
    throw new Error("GRAPHITI_MCP_ENDPOINT_PATH_INVALID");
  }
  if (url.protocol === "https:") return url;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "http:" || (!loopback && acknowledgement !== "private-network")) {
    throw new Error("GRAPHITI_MCP_HTTPS_REQUIRED");
  }
  return url;
}

export class HttpGraphitiMcpTransport implements GraphitiToolTransport {
  private readonly endpoint: URL;
  private readonly fetcher: Fetcher;
  private sessionId?: string;
  private initialization?: Promise<void>;
  private nextId = 1;

  constructor(options: {
    endpoint: string;
    plaintextPrivateNetworkAck?: string;
    fetcher?: Fetcher;
  }) {
    this.endpoint = endpoint(options.endpoint, options.plaintextPrivateNetworkAck);
    this.fetcher = options.fetcher ?? fetch;
  }

  private async post(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = notification ? undefined : this.nextId++;
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
    });
    if (!response.ok) throw new Error(`GRAPHITI_MCP_HTTP_${response.status}`);
    const nextSession = response.headers.get("mcp-session-id");
    if (nextSession) this.sessionId = nextSession;
    if (notification || response.status === 202) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    const rpc = contentType.includes("text/event-stream")
      ? parseSse(await response.text())
      : (record(await response.json()) as JsonRpcResponse);
    if (rpc.id !== id) throw new Error("GRAPHITI_MCP_RESPONSE_ID_MISMATCH");
    if (rpc.error) throw new Error(`GRAPHITI_MCP_ERROR:${rpc.error.message ?? "unknown"}`);
    return rpc.result;
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      const initialized = record(
        await this.post("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "ai-world-graphiti-adapter", version: "1" },
        }),
      );
      if (typeof initialized.protocolVersion !== "string" || !this.sessionId) {
        throw new Error("GRAPHITI_MCP_INITIALIZATION_INVALID");
      }
      await this.post("notifications/initialized", {}, true);
    })();
    return this.initialization;
  }

  async listTools(): Promise<GraphitiTool[]> {
    await this.initialize();
    const result = record(await this.post("tools/list", {}));
    if (!Array.isArray(result.tools)) throw new Error("GRAPHITI_MCP_TOOLS_INVALID");
    return result.tools.map((value) => {
      const tool = record(value);
      const inputSchema = record(tool.inputSchema);
      if (typeof tool.name !== "string") throw new Error("GRAPHITI_MCP_TOOL_INVALID");
      return { name: tool.name, inputSchema } as GraphitiTool;
    });
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean }> {
    await this.initialize();
    const result = record(await this.post("tools/call", { name, arguments: args }));
    return { isError: result.isError === true };
  }
}
