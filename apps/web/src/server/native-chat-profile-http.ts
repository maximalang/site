import {
  type NativeChatBrowserProfileConfiguration,
  NativeChatBrowserProfileConfigurationInputSchema,
  NativeChatBrowserProfileConfigurationSchema,
  type NativeChatBrowserProfileList,
  NativeChatBrowserProfileListSchema,
} from "@agent-world/domain";
import { NativeChatLaunchStoreError } from "@agent-world/postgres-store";
import { hasSameOriginHost } from "./request-security";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type ConfigurationWrite = Parameters<
  import("@agent-world/postgres-store").PostgresNativeChatLaunchStore["configureProfile"]
>[0];

export type NativeChatProfileHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  list(): Promise<NativeChatBrowserProfileList>;
  configure(input: ConfigurationWrite): Promise<NativeChatBrowserProfileConfiguration>;
  now?: () => Date;
};

function error(code: string, status: number): Response {
  return Response.json({ error: { code } }, { headers: RESPONSE_HEADERS, status });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("Invalid content type");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 5_000) throw new Error("Oversized request");
  return JSON.parse(text) as unknown;
}

export function createNativeChatProfileRouteHandler(
  dependencies: NativeChatProfileHttpDependencies,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }

    if (request.method === "GET") {
      try {
        const profiles = NativeChatBrowserProfileListSchema.parse(await dependencies.list());
        return Response.json(profiles, { headers: RESPONSE_HEADERS, status: 200 });
      } catch {
        return error("NATIVE_CHAT_PROFILES_UNAVAILABLE", 503);
      }
    }
    if (request.method !== "PUT" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }

    let input: ReturnType<typeof NativeChatBrowserProfileConfigurationInputSchema.parse>;
    try {
      input = NativeChatBrowserProfileConfigurationInputSchema.parse(await readBody(request));
    } catch {
      return error("INVALID_REQUEST", 400);
    }

    try {
      const configured = NativeChatBrowserProfileConfigurationSchema.parse(
        await dependencies.configure({
          ...input,
          updatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        }),
      );
      return Response.json(configured, { headers: RESPONSE_HEADERS, status: 200 });
    } catch (cause) {
      if (cause instanceof NativeChatLaunchStoreError) {
        const status = cause.code === "INVALID_ACCOUNT" ? 422 : 409;
        return error(cause.code, status);
      }
      return error("NATIVE_CHAT_PROFILES_UNAVAILABLE", 503);
    }
  };
}
