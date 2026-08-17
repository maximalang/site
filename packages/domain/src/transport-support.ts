import * as z from "zod";
import type { ExecutionAdapterKind } from "./identity.js";

export const TransportSupportStatusSchema = z.enum([
  "OFFICIAL",
  "EXPERIMENTAL",
  "UNSUPPORTED",
  "DISABLED",
]);
export type TransportSupportStatus = z.infer<typeof TransportSupportStatusSchema>;

export const ChatWorkTransportCapabilitySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    mode: z.enum(["CHAT", "WORK"]),
    adapterKind: z.enum(["NATIVE_CHATGPT", "NATIVE_WORK"]),
    status: TransportSupportStatusSchema,
    selectable: z.boolean(),
    dispatchChannel: z.enum(["BROWSER_RUN_ID", "UNAVAILABLE"]),
    resultChannel: z.enum(["CONTROL_API", "UNAVAILABLE"]),
    reasonCode: z.enum([
      "LIVE_EVIDENCE_REQUIRED",
      "NO_SUPPORTED_TRANSPORT",
      "OWNER_DISABLED",
      "SUPPORTED_PROVIDER_SURFACE",
    ]),
  })
  .superRefine((capability, context) => {
    if (
      (capability.adapterKind === "NATIVE_CHATGPT" && capability.mode !== "CHAT") ||
      (capability.adapterKind === "NATIVE_WORK" && capability.mode !== "WORK")
    ) {
      context.addIssue({
        code: "custom",
        message: "Chat/Work transport mode does not match its adapter",
      });
    }
    if (
      (capability.status === "UNSUPPORTED" || capability.status === "DISABLED") &&
      capability.selectable
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported or disabled transports cannot be selectable",
      });
    }
  });
export type ChatWorkTransportCapability = z.infer<typeof ChatWorkTransportCapabilitySchema>;

export const CURRENT_CHAT_WORK_TRANSPORT_CAPABILITIES = Object.freeze(
  ChatWorkTransportCapabilitySchema.array()
    .length(2)
    .parse([
      {
        schemaVersion: 1,
        mode: "CHAT",
        adapterKind: "NATIVE_CHATGPT",
        status: "EXPERIMENTAL",
        selectable: false,
        dispatchChannel: "BROWSER_RUN_ID",
        resultChannel: "CONTROL_API",
        reasonCode: "LIVE_EVIDENCE_REQUIRED",
      },
      {
        schemaVersion: 1,
        mode: "WORK",
        adapterKind: "NATIVE_WORK",
        status: "UNSUPPORTED",
        selectable: false,
        dispatchChannel: "UNAVAILABLE",
        resultChannel: "UNAVAILABLE",
        reasonCode: "NO_SUPPORTED_TRANSPORT",
      },
    ]),
);

export function getChatWorkTransportCapability(
  adapterKind: ExecutionAdapterKind,
): ChatWorkTransportCapability | undefined {
  return CURRENT_CHAT_WORK_TRANSPORT_CAPABILITIES.find(
    (capability) => capability.adapterKind === adapterKind,
  );
}

export function isExecutionAdapterSelectable(adapterKind: ExecutionAdapterKind): boolean {
  return getChatWorkTransportCapability(adapterKind)?.selectable ?? true;
}
