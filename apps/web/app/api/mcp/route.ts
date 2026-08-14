import { NativeChatControlEventInputSchema } from "@agent-world/domain";
import { verifyNativeChatMcpAccessToken } from "../../../src/server/native-chat-mcp-auth";
import { createNativeChatMcpHandlers } from "../../../src/server/native-chat-mcp-http";
import { appendApplicationNativeChatControl } from "../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DISABLED_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function configuration() {
  const enabled = process.env.AGENT_WORLD_MCP_ENABLED === "true";
  const resource = process.env.AGENT_WORLD_MCP_RESOURCE?.trim();
  const issuer = process.env.AGENT_WORLD_MCP_OAUTH_ISSUER?.trim();
  if (!enabled || !resource || !issuer) return undefined;
  try {
    const resourceUrl = new URL(resource);
    const issuerUrl = new URL(issuer);
    if (resourceUrl.protocol !== "https:" || issuerUrl.protocol !== "https:") return undefined;
    return { resource, issuer };
  } catch {
    return undefined;
  }
}

function disabled() {
  return Response.json(
    { error: { code: "NOT_FOUND" } },
    { status: 404, headers: DISABLED_HEADERS },
  );
}

function handlers() {
  const config = configuration();
  if (!config) return undefined;
  return createNativeChatMcpHandlers({
    resource: config.resource,
    authorize: async (request) => {
      const result = await verifyNativeChatMcpAccessToken(
        request.headers.get("authorization"),
        config,
      );
      return result.ok ? { accountId: result.accountId, scopes: result.scopes } : undefined;
    },
    append: (accountId, event) =>
      appendApplicationNativeChatControl(accountId, NativeChatControlEventInputSchema.parse(event)),
  });
}

export async function GET() {
  return handlers()?.GET() ?? disabled();
}

export async function POST(request: Request) {
  return handlers()?.POST(request) ?? disabled();
}
