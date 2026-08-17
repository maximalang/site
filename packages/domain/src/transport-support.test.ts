import { describe, expect, it } from "vitest";
import {
  ChatWorkTransportCapabilitySchema,
  CURRENT_CHAT_WORK_TRANSPORT_CAPABILITIES,
  getChatWorkTransportCapability,
  isExecutionAdapterSelectable,
  TransportSupportStatusSchema,
} from "./transport-support.js";

describe("Chat/Work transport support taxonomy", () => {
  it("keeps the support vocabulary explicit and bounded", () => {
    expect(TransportSupportStatusSchema.options).toEqual([
      "OFFICIAL",
      "EXPERIMENTAL",
      "UNSUPPORTED",
      "DISABLED",
    ]);
  });

  it("marks Native Plus Chat experimental and non-selectable until live evidence exists", () => {
    expect(getChatWorkTransportCapability("NATIVE_CHATGPT")).toEqual({
      schemaVersion: 1,
      mode: "CHAT",
      adapterKind: "NATIVE_CHATGPT",
      status: "EXPERIMENTAL",
      selectable: false,
      dispatchChannel: "BROWSER_RUN_ID",
      resultChannel: "CONTROL_API",
      reasonCode: "LIVE_EVIDENCE_REQUIRED",
    });
    expect(isExecutionAdapterSelectable("NATIVE_CHATGPT")).toBe(false);
  });

  it("marks Native Work unsupported without inventing an automation surface", () => {
    expect(getChatWorkTransportCapability("NATIVE_WORK")).toEqual({
      schemaVersion: 1,
      mode: "WORK",
      adapterKind: "NATIVE_WORK",
      status: "UNSUPPORTED",
      selectable: false,
      dispatchChannel: "UNAVAILABLE",
      resultChannel: "UNAVAILABLE",
      reasonCode: "NO_SUPPORTED_TRANSPORT",
    });
    expect(isExecutionAdapterSelectable("NATIVE_WORK")).toBe(false);
  });

  it("does not block independently supported non-native adapters", () => {
    expect(isExecutionAdapterSelectable("OPENCLAW")).toBe(true);
    expect(isExecutionAdapterSelectable("CODEX")).toBe(true);
    expect(CURRENT_CHAT_WORK_TRANSPORT_CAPABILITIES).toHaveLength(2);
  });

  it("rejects impossible support declarations", () => {
    expect(
      ChatWorkTransportCapabilitySchema.safeParse({
        schemaVersion: 1,
        mode: "WORK",
        adapterKind: "NATIVE_CHATGPT",
        status: "OFFICIAL",
        selectable: true,
        dispatchChannel: "BROWSER_RUN_ID",
        resultChannel: "CONTROL_API",
        reasonCode: "SUPPORTED_PROVIDER_SURFACE",
      }).success,
    ).toBe(false);
    expect(
      ChatWorkTransportCapabilitySchema.safeParse({
        schemaVersion: 1,
        mode: "WORK",
        adapterKind: "NATIVE_WORK",
        status: "UNSUPPORTED",
        selectable: true,
        dispatchChannel: "UNAVAILABLE",
        resultChannel: "UNAVAILABLE",
        reasonCode: "NO_SUPPORTED_TRANSPORT",
      }).success,
    ).toBe(false);
  });
});
