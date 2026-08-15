import {
  IntegrationActionResultSchema,
  IntegrationActionSchema,
  IntegrationCreateSchema,
  IntegrationIdSchema,
  IntegrationMutationReceiptSchema,
  IntegrationMutationRequestIdSchema,
  IntegrationMutationSchema,
  IntegrationRegistrySchema,
  IntegrationToolAllowlistCreateSchema,
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
const ProbeSchema = z.strictObject({
  operation: z.literal("TEST"),
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
});
const ActionSchema = z.strictObject({
  operation: z.literal("ACTION"),
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
  action: IntegrationActionSchema,
});
const MutationRequestSchema = z.strictObject({
  operation: z.literal("REQUEST_MUTATION"),
  requestId: IntegrationMutationRequestIdSchema,
  integrationId: IntegrationIdSchema,
  commandId: z.string().trim().min(1).max(512),
  mutation: IntegrationMutationSchema,
});
const MutationDecisionSchema = z.strictObject({
  operation: z.literal("DECIDE_MUTATION"),
  requestId: IntegrationMutationRequestIdSchema,
  commandId: z.string().trim().min(1).max(512),
  decision: z.enum(["APPROVE", "DENY"]),
});
const RegisterToolSchema = IntegrationToolAllowlistCreateSchema.omit({ createdAt: true }).extend({
  operation: z.literal("REGISTER_TOOL"),
});
const RegisterToolResultSchema = z.strictObject({
  outcome: z.enum(["CREATED", "REPLAY"]),
  toolAllowlistId: IntegrationToolAllowlistCreateSchema.shape.id,
});
const ProbeResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  integrationId: IntegrationIdSchema,
  outcome: z.enum(["RECORDED", "REPLAY"]),
  health: z.enum(["READY", "ERROR"]),
  code: z.string().min(1).max(120),
  checkedAt: z.iso.datetime({ offset: true }),
});

export type IntegrationHttpDependencies = {
  authorize(request: Request): Promise<boolean>;
  list(): Promise<unknown>;
  create(input: z.infer<typeof IntegrationCreateSchema>): Promise<unknown>;
  credential(input: z.infer<typeof CredentialSchema>, writtenAt: string): Promise<unknown>;
  lifecycle(input: z.infer<typeof LifecycleSchema>, updatedAt: string): Promise<unknown>;
  probe(input: z.infer<typeof ProbeSchema>, checkedAt: string): Promise<unknown>;
  action(input: z.infer<typeof ActionSchema>, executedAt: string): Promise<unknown>;
  registerTool?(
    input: Omit<z.infer<typeof RegisterToolSchema>, "operation">,
    createdAt: string,
  ): Promise<unknown>;
  requestMutation(
    input: z.infer<typeof MutationRequestSchema>,
    requestedAt: string,
  ): Promise<unknown>;
  decideMutation(
    input: z.infer<typeof MutationDecisionSchema>,
    decidedAt: string,
  ): Promise<unknown>;
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
              : raw.operation === "TEST"
                ? ProbeResultSchema.parse(await dependencies.probe(ProbeSchema.parse(raw), now))
                : raw.operation === "ACTION"
                  ? IntegrationActionResultSchema.parse(
                      await dependencies.action(ActionSchema.parse(raw), now),
                    )
                  : raw.operation === "REGISTER_TOOL" && dependencies.registerTool
                    ? RegisterToolResultSchema.parse(
                        await dependencies.registerTool(
                          (({ operation: _operation, ...command }) => command)(
                            RegisterToolSchema.parse(raw),
                          ),
                          now,
                        ),
                      )
                    : raw.operation === "REQUEST_MUTATION"
                      ? IntegrationMutationReceiptSchema.parse(
                          await dependencies.requestMutation(MutationRequestSchema.parse(raw), now),
                        )
                      : raw.operation === "DECIDE_MUTATION"
                        ? IntegrationMutationReceiptSchema.parse(
                            await dependencies.decideMutation(
                              MutationDecisionSchema.parse(raw),
                              now,
                            ),
                          )
                        : await dependencies.create(IntegrationCreateSchema.parse(raw));
        return Response.json({ schemaVersion: 1, result }, { headers, status: 201 });
      } catch {
        return error("INTEGRATION_COMMAND_REJECTED", 409);
      }
    },
  };
}
