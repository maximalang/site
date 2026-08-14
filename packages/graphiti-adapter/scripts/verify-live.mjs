import { GraphitiMemoryAdapter, HttpGraphitiMcpTransport } from "../dist/index.js";

if (process.env.AGENT_WORLD_GRAPHITI_LIVE_ACK !== "readiness-only") {
  throw new Error("AGENT_WORLD_GRAPHITI_LIVE_ACK=readiness-only is required");
}
const endpoint = process.env.AGENT_WORLD_GRAPHITI_MCP_URL;
if (!endpoint) throw new Error("AGENT_WORLD_GRAPHITI_MCP_URL is required");

const transport = new HttpGraphitiMcpTransport({
  endpoint,
  plaintextPrivateNetworkAck: process.env.AGENT_WORLD_GRAPHITI_PLAINTEXT_ACK,
});
const receipt = await new GraphitiMemoryAdapter(transport).apply([]);
if (receipt.appliedThrough !== 0) throw new Error("Graphiti readiness mutated projection state");
process.stdout.write(
  `${JSON.stringify({ status: "PASS", endpoint: new URL(endpoint).origin, schema: "add_memory-temporal-v1", writes: 0 })}\n`,
);
