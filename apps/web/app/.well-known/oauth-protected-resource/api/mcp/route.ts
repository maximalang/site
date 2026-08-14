import { nativeChatProtectedResourceMetadata } from "../../../../../src/server/native-chat-mcp-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const resource = process.env.AGENT_WORLD_MCP_RESOURCE?.trim();
  const issuer = process.env.AGENT_WORLD_MCP_OAUTH_ISSUER?.trim();
  if (process.env.AGENT_WORLD_MCP_ENABLED !== "true" || !resource || !issuer) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: HEADERS });
  }
  try {
    return Response.json(nativeChatProtectedResourceMetadata(resource, issuer), {
      headers: HEADERS,
    });
  } catch {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: HEADERS });
  }
}
