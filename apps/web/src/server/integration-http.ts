import {
  IntegrationCreateSchema,
  IntegrationIdSchema,
  IntegrationRegistrySchema,
} from "@agent-world/read-model";
import * as z from "zod";
import { hasSameOriginHost } from "./request-security";

const MAX_BYTES = 32_768;
const CredentialSchema = z.strictObject({
  operation: z.literal("CREDENTIAL"),
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
  plaintext: z.string().min(1).max(16_384),
});
const LifecycleSchema = z.strictObject({
  operation: z.enum(["ENABLE", "DISABLE"]),
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
});

export type IntegrationHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  list(): Promise<unknown>;
  create(input: z.infer<typeof IntegrationCreateSchema>): Promise<unknown>;
  credential(input: z.infer<typeof CredentialSchema>, writtenAt: string): Promise<unknown>;
  lifecycle(input: z.infer<typeof LifecycleSchema>, updatedAt: string): Promise<unknown>;
  now?: () => Date;
};
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const error = (code: string, status: number) =>
  Response.json({ error: { code } }, { headers, status });

export function createIntegrationRouteHandlers(dependencies: IntegrationHttpDependencies) {
  return {
    GET: async (request: Request) => {
      try {
        if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
      } catch {
        return error("UNAUTHORIZED", 401);
      }
      try {
        return Response.json(IntegrationRegistrySchema.parse(await dependencies.list()), {
          headers,
        });
      } catch {
        return error("INTEGRATION_REGISTRY_UNAVAILABLE", 503);
      }
    },
    POST: async (request: Request) => {
      try {
        if ((await dependencies.authorize(request)) !== true) return error("UNAUTHORIZED", 401);
      } catch {
        return error("UNAUTHORIZED", 401);
      }
      if (!hasSameOriginHost(request)) return error("INVALID_REQUEST", 400);
      try {
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
          throw new Error("content-type");
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("large");
        const raw = JSON.parse(text);
        const now = (dependencies.now ?? (() => new Date()))().toISOString();
        const result =
          raw.operation === "CREDENTIAL"
            ? await dependencies.credential(CredentialSchema.parse(raw), now)
            : raw.operation === "ENABLE" || raw.operation === "DISABLE"
              ? await dependencies.lifecycle(LifecycleSchema.parse(raw), now)
              : await dependencies.create(IntegrationCreateSchema.parse(raw));
        return Response.json({ schemaVersion: 1, result }, { headers, status: 201 });
      } catch {
        return error("INTEGRATION_COMMAND_REJECTED", 409);
      }
    },
  };
}
