import {
  NativeChatControlEventInputSchema,
  NativeChatPullRequestSchema,
} from "@agent-world/domain";
import { createNativeChatActionsHandlers } from "../../../../../src/server/native-chat-actions-http";
import { verifyNativeChatMcpAccessToken } from "../../../../../src/server/native-chat-mcp-auth";
import {
  appendApplicationNativeChatControl,
  pullApplicationNativeChatResources,
} from "../../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function handlers() {
  const enabled = process.env.AGENT_WORLD_MCP_ENABLED === "true";
  const resource = process.env.AGENT_WORLD_MCP_RESOURCE?.trim();
  const issuer = process.env.AGENT_WORLD_MCP_OAUTH_ISSUER?.trim();
  if (!enabled || !resource || !issuer) return undefined;
  return createNativeChatActionsHandlers({
    resource,
    authorize: async (request) => {
      const result = await verifyNativeChatMcpAccessToken(request.headers.get("authorization"), {
        resource,
        issuer,
      });
      return result.ok ? { accountId: result.accountId, scopes: result.scopes } : undefined;
    },
    append: (accountId, event) =>
      appendApplicationNativeChatControl(accountId, NativeChatControlEventInputSchema.parse(event)),
    pull: (accountId, request) =>
      pullApplicationNativeChatResources(accountId, NativeChatPullRequestSchema.parse(request)),
  });
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const active = handlers();
  if (!active) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  return active.POST(request, (await context.params).operation);
}
