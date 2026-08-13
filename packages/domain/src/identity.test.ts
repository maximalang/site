import { describe, expect, it } from "vitest";
import {
  AccountIdSchema,
  AccountRefSchema,
  AgentIdSchema,
  AgentSchema,
  ExecutionRouteSchema,
  RuntimeBindingSchema,
  SessionIdSchema,
} from "./index.js";

const UUID = "019ff96a-07fa-76a3-a020-9a32cf2d1a51";

describe("canonical identity contracts", () => {
  it("parses an Agent independently from an Account", () => {
    const agent = AgentSchema.parse({
      schemaVersion: 1,
      id: `agent_${UUID}`,
      slug: "researcher",
      displayName: "Researcher",
      role: "Evidence-first researcher",
      instructions: "Research the assigned question and preserve provenance.",
      isEnabled: true,
    });
    const account = AccountRefSchema.parse({
      schemaVersion: 1,
      id: `account_${UUID}`,
      label: "Primary ChatGPT account",
    });

    expect(agent.id).toBe(`agent_${UUID}`);
    expect(account.id).toBe(`account_${UUID}`);
    expect(agent).not.toHaveProperty("accountId");
  });

  it("rejects Account and Session IDs at the Agent ID boundary", () => {
    expect(AgentIdSchema.safeParse(`account_${UUID}`).success).toBe(false);
    expect(AgentIdSchema.safeParse(`session_${UUID}`).success).toBe(false);
    expect(AccountIdSchema.safeParse(`agent_${UUID}`).success).toBe(false);
    expect(SessionIdSchema.safeParse(`agent_${UUID}`).success).toBe(false);
  });

  it("rejects unknown fields instead of silently accepting domain drift", () => {
    const result = AgentSchema.safeParse({
      schemaVersion: 1,
      id: `agent_${UUID}`,
      slug: "researcher",
      displayName: "Researcher",
      role: "Researcher",
      instructions: "Research.",
      isEnabled: true,
      accountId: `account_${UUID}`,
    });

    expect(result.success).toBe(false);
  });

  it("binds an Agent to an opaque runtime identity without conflating them", () => {
    const binding = RuntimeBindingSchema.parse({
      schemaVersion: 1,
      id: `binding_${UUID}`,
      agentId: `agent_${UUID}`,
      routeId: `route_${UUID}`,
      adapterKind: "OPENCLAW",
      externalAgentId: "main",
      isEnabled: true,
    });

    expect(binding.agentId).toBe(`agent_${UUID}`);
    expect(binding.externalAgentId).toBe("main");
    expect(binding.agentId).not.toBe(binding.externalAgentId);
  });

  it("rejects identity substitution and empty external runtime IDs", () => {
    const wrongAgent = RuntimeBindingSchema.safeParse({
      schemaVersion: 1,
      id: `binding_${UUID}`,
      agentId: `session_${UUID}`,
      routeId: `route_${UUID}`,
      adapterKind: "OPENCLAW",
      externalAgentId: "main",
      isEnabled: true,
    });
    const emptyExternalId = RuntimeBindingSchema.safeParse({
      schemaVersion: 1,
      id: `binding_${UUID}`,
      agentId: `agent_${UUID}`,
      routeId: `route_${UUID}`,
      adapterKind: "OPENCLAW",
      externalAgentId: "",
      isEnabled: true,
    });
    const controlCharacter = RuntimeBindingSchema.safeParse({
      schemaVersion: 1,
      id: `binding_${UUID}`,
      agentId: `agent_${UUID}`,
      routeId: `route_${UUID}`,
      adapterKind: "OPENCLAW",
      externalAgentId: "main\nforged-event",
      isEnabled: true,
    });

    expect(wrongAgent.success).toBe(false);
    expect(emptyExternalId.success).toBe(false);
    expect(controlCharacter.success).toBe(false);
  });

  it("defines an execution route without embedding Account credentials", () => {
    const route = ExecutionRouteSchema.parse({
      schemaVersion: 1,
      id: `route_${UUID}`,
      label: "Primary OpenClaw route",
      mode: "CHAT",
      adapterKind: "OPENCLAW",
      accountId: `account_${UUID}`,
      isEnabled: true,
    });

    expect(route.accountId).toBe(`account_${UUID}`);
    expect(route).not.toHaveProperty("credentials");
  });
});
