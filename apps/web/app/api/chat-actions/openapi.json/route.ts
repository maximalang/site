import { nativeChatActionsOpenApi } from "../../../../src/server/native-chat-actions-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const enabled = process.env.AGENT_WORLD_MCP_ENABLED === "true";
  const resource = process.env.AGENT_WORLD_MCP_RESOURCE?.trim();
  const issuer = process.env.AGENT_WORLD_MCP_OAUTH_ISSUER?.trim();
  if (!enabled || !resource || !issuer) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  try {
    return Response.json(nativeChatActionsOpenApi(resource, issuer), {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
}
