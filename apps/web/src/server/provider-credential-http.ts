import { type ProviderCredentialWriteInput, SecretStoreError } from "@agent-world/postgres-store";
import {
  type ProviderCredentialWriteRequest,
  ProviderCredentialWriteRequestSchema,
  ProviderCredentialWriteResponseSchema,
} from "@agent-world/read-model";
import { hasSameOriginHost } from "./request-security";

const MAX_REQUEST_BYTES = 20_000;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export type ProviderCredentialHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  write(
    input: ProviderCredentialWriteInput,
  ): Promise<{ outcome: "CREATED" | "ROTATED" | "REPLAY"; version: number }>;
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
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Provider credential request is too large");
  }
  return JSON.parse(text) as unknown;
}

export function createProviderCredentialRouteHandler(
  dependencies: ProviderCredentialHttpDependencies,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
    } catch {
      return error("UNAUTHORIZED", 401);
    }
    if (request.method !== "POST" || !hasSameOriginHost(request)) {
      return error("INVALID_REQUEST", 400);
    }
    let command: ProviderCredentialWriteRequest;
    try {
      command = ProviderCredentialWriteRequestSchema.parse(await readBody(request));
    } catch {
      return error("INVALID_REQUEST", 400);
    }
    try {
      const receipt = await dependencies.write({
        commandId: command.commandId,
        accountId: command.accountId,
        plaintext: command.apiKey,
        writtenAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      });
      const response = ProviderCredentialWriteResponseSchema.parse({
        schemaVersion: 1,
        outcome: receipt.outcome,
        accountId: command.accountId,
        credentialConfigured: true,
        version: receipt.version,
      });
      return Response.json(response, {
        headers: RESPONSE_HEADERS,
        status: response.outcome === "CREATED" ? 201 : 200,
      });
    } catch (cause) {
      if (cause instanceof SecretStoreError) {
        return error(cause.code, cause.code === "INVALID_REFERENCE" ? 422 : 409);
      }
      return error("SECRET_STORE_UNAVAILABLE", 503);
    }
  };
}
