import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, connect, isIP } from "node:net";
import type { ExecutableIntegrationMutation } from "@agent-world/postgres-store";
import type { IntegrationAction } from "@agent-world/read-model";
import { Client as SshClient } from "ssh2";

const MAX_REMOTE_RESPONSE_BYTES = 32_768;

type SshExecutionInput = {
  address: string;
  port: number;
  username: string;
  privateKey: string;
  hostKeySha256: string;
  command: string;
};

function executeSsh(input: SshExecutionInput): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    let hostKeyMismatch = false;
    const timeout = setTimeout(() => finish(new Error("SSH_EXECUTION_TIMEOUT")), 120_000);
    timeout.unref();
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end();
      if (error) reject(error);
      else resolve({ code });
    };
    client
      .once("ready", () => {
        client.exec(input.command, { pty: false }, (error, stream) => {
          if (error) return finish(error);
          let bytes = 0;
          const consume = (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_REMOTE_RESPONSE_BYTES) finish(new Error("SSH_OUTPUT_TOO_LARGE"));
          };
          stream.on("data", consume);
          stream.stderr.on("data", consume);
          stream.once("close", (code: number | null) => finish(undefined, code));
          stream.once("error", finish);
        });
      })
      .once("error", (error: Error) =>
        finish(hostKeyMismatch ? new Error("HOST_KEY_MISMATCH") : error),
      )
      .once("close", () => finish(new Error("SSH_CONNECTION_CLOSED")))
      .connect({
        host: input.address,
        port: input.port,
        username: input.username,
        privateKey: input.privateKey,
        hostVerifier: (key: Buffer) => {
          const fingerprint = `SHA256:${createHash("sha256")
            .update(key)
            .digest("base64")
            .replace(/=+$/, "")}`;
          const accepted = fingerprint === input.hostKeySha256;
          hostKeyMismatch = !accepted;
          return accepted;
        },
        readyTimeout: 10_000,
        keepaliveInterval: 2_000,
        keepaliveCountMax: 2,
      });
  });
}

function sshCommand(
  operation: Extract<
    ExecutableIntegrationMutation,
    { kind: "SSH_RUN_REGISTERED_OPERATION" }
  >["operation"],
) {
  return operation.kind === "SYSTEMD_RESTART"
    ? `sudo -n systemctl restart -- ${operation.systemdUnit}`
    : `cd -- ${operation.workingDirectory} && docker compose --project-name ${operation.composeProject} pull && docker compose --project-name ${operation.composeProject} up -d --remove-orphans`;
}

export type ProbeTarget = Awaited<
  ReturnType<import("@agent-world/postgres-store").PostgresIntegrationStore["loadProbeTarget"]>
>;
export type ProbeResult = { health: "READY" | "ERROR"; code: string };

const reservedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  reservedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  reservedAddresses.addSubnet(network, prefix, "ipv6");

function privateAddress(address: string) {
  const family = isIP(address);
  return family === 0 || reservedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

async function resolveHost(host: string, allowedHosts: Set<string>, allowPrivateNetwork: boolean) {
  const normalized = host.toLowerCase();
  if (!allowedHosts.has(normalized)) throw new Error("HOST_NOT_ALLOWLISTED");
  const addresses = isIP(normalized)
    ? [{ address: normalized, family: isIP(normalized) }]
    : await dns.lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("HOST_UNRESOLVED");
  if (!allowPrivateNetwork && addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("PRIVATE_NETWORK_NOT_ACKNOWLEDGED");
  }
  const selected = addresses[0];
  if (!selected) throw new Error("HOST_UNRESOLVED");
  return selected;
}

function httpsCall(
  url: URL,
  address: string,
  family: number,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string,
) {
  return new Promise<{
    status: number;
    body: string;
    contentType: string;
    sessionId?: string;
  }>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        headers,
        timeout: 5_000,
        lookup: (_hostname, _options, callback) => callback(null, address, family),
      },
      (response) => {
        let content = "";
        let receivedBytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          receivedBytes += Buffer.byteLength(chunk, "utf8");
          if (receivedBytes > MAX_REMOTE_RESPONSE_BYTES) {
            request.destroy(new Error("REMOTE_RESPONSE_TOO_LARGE"));
            return;
          }
          content += chunk;
        });
        response.on("end", () => {
          const sessionId = response.headers["mcp-session-id"];
          resolve({
            status: response.statusCode ?? 0,
            body: content,
            contentType: String(response.headers["content-type"] ?? ""),
            ...(typeof sessionId === "string" ? { sessionId } : {}),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("PROBE_TIMEOUT")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function sshBanner(address: string, port: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: address, port, timeout: 5_000 });
    let banner = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      banner += chunk;
      if (banner.includes("\n") || banner.length > 255) {
        socket.destroy();
        banner.startsWith("SSH-")
          ? resolve(banner.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? "SSH")
          : reject(new Error("SSH_BANNER_INVALID"));
      }
    });
    socket.on("timeout", () => socket.destroy(new Error("PROBE_TIMEOUT")));
    socket.on("error", reject);
    socket.on("end", () =>
      banner.startsWith("SSH-")
        ? resolve(banner.split(/\r?\n/, 1)[0]?.slice(0, 120) ?? "SSH")
        : reject(new Error("SSH_BANNER_INVALID")),
    );
  });
}

type ActionItem = { id: string; label: string; detail?: string };
function safeText(value: unknown, max: number) {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  return [...text]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127 ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, max);
}
function jsonPayload(response: { body: string; contentType: string }) {
  const payload = response.contentType.includes("text/event-stream")
    ? response.body
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim()
    : response.body;
  if (!payload) throw new Error("REMOTE_RESPONSE_INVALID");
  return JSON.parse(payload) as Record<string, unknown>;
}

export function createNodeIntegrationAction(
  configuration: {
    allowedHosts: string[];
    allowPrivateNetwork: boolean;
  },
  dependencies: {
    resolve?: typeof resolveHost;
    https?: typeof httpsCall;
    ssh?: typeof sshBanner;
  } = {},
) {
  const resolveTarget = dependencies.resolve ?? resolveHost;
  const callHttps = dependencies.https ?? httpsCall;
  const inspectSsh = dependencies.ssh ?? sshBanner;
  const allowedHosts = new Set(
    configuration.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
  );
  return async (
    target: ProbeTarget,
    action: IntegrationAction,
    credential?: string,
  ): Promise<{ status: "SUCCEEDED" | "FAILED"; items: ActionItem[] }> => {
    try {
      if (!target.isEnabled || target.health !== "READY") throw new Error("INTEGRATION_NOT_READY");
      if (target.kind !== action.split("_", 1)[0])
        throw new Error("INTEGRATION_ACTION_KIND_MISMATCH");
      if (target.endpoint.transport === "SSH") {
        if (action !== "SSH_INSPECT_HOST") throw new Error("INTEGRATION_ACTION_KIND_MISMATCH");
        const resolved = await resolveTarget(
          target.endpoint.host,
          allowedHosts,
          configuration.allowPrivateNetwork,
        );
        const banner = await inspectSsh(resolved.address, target.endpoint.port);
        return {
          status: "SUCCEEDED",
          items: [{ id: "ssh", label: "SSH reachable", detail: banner }],
        };
      }
      const url = new URL(target.endpoint.url);
      if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
      const resolved = await resolveTarget(
        url.hostname,
        allowedHosts,
        configuration.allowPrivateNetwork,
      );
      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": "agent-world-integration-action/1",
      };
      let response: Awaited<ReturnType<typeof httpsCall>>;
      if (action === "MCP_LIST_TOOLS" && target.kind === "MCP") {
        headers.accept = "application/json, text/event-stream";
        headers["content-type"] = "application/json";
        if (credential) headers.authorization = `Bearer ${credential}`;
        const initialize = await callHttps(
          url,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({
            jsonrpc: "2.0",
            id: "initialize",
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "agent-world", version: "1" },
            },
          }),
        );
        if (initialize.status < 200 || initialize.status >= 300)
          throw new Error("REMOTE_UNHEALTHY");
        if (initialize.sessionId) headers["mcp-session-id"] = initialize.sessionId;
        const initialized = await callHttps(
          url,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        );
        if (initialized.status < 200 || initialized.status >= 300)
          throw new Error("REMOTE_UNHEALTHY");
        response = await callHttps(
          url,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list", params: {} }),
        );
        if (response.status < 200 || response.status >= 300) throw new Error("REMOTE_UNHEALTHY");
        const payload = jsonPayload(response);
        const tools = (payload.result as { tools?: unknown } | undefined)?.tools;
        if (!Array.isArray(tools)) throw new Error("MCP_TOOLS_INVALID");
        const items = tools.slice(0, 100).flatMap((tool): ActionItem[] => {
          if (!tool || typeof tool !== "object") return [];
          const value = tool as Record<string, unknown>;
          const id = safeText(value.name, 120);
          if (!id) return [];
          const description = safeText(value.description, 240);
          return [{ id, label: id, ...(description ? { detail: description } : {}) }];
        });
        return { status: "SUCCEEDED", items };
      }
      if (action === "N8N_LIST_WORKFLOWS" && target.kind === "N8N") {
        url.pathname = "/api/v1/workflows";
        url.search = "limit=100";
        if (credential) headers["x-n8n-api-key"] = credential;
        response = await callHttps(url, resolved.address, resolved.family, "GET", headers);
        if (response.status < 200 || response.status >= 300) throw new Error("REMOTE_UNHEALTHY");
        const payload = jsonPayload(response);
        const workflows = payload.data;
        if (!Array.isArray(workflows)) throw new Error("N8N_WORKFLOWS_INVALID");
        return {
          status: "SUCCEEDED",
          items: workflows.slice(0, 100).flatMap((workflow): ActionItem[] => {
            if (!workflow || typeof workflow !== "object") return [];
            const value = workflow as Record<string, unknown>;
            const id = safeText(value.id, 120);
            const label = safeText(value.name, 240);
            if (!id || !label) return [];
            return [{ id, label, detail: value.active === true ? "active" : "inactive" }];
          }),
        };
      }
      if (action === "GITHUB_LIST_REPOSITORIES" && target.kind === "GITHUB") {
        if (!credential) throw new Error("CREDENTIAL_REQUIRED");
        headers.authorization = `Bearer ${credential}`;
        headers.accept = "application/vnd.github+json";
        headers["x-github-api-version"] = "2026-03-10";
        url.pathname = "/user/repos";
        url.search = "per_page=100&sort=updated";
        response = await callHttps(url, resolved.address, resolved.family, "GET", headers);
        if (response.status < 200 || response.status >= 300) throw new Error("REMOTE_UNHEALTHY");
        const repositories = jsonPayload(response);
        if (!Array.isArray(repositories)) throw new Error("GITHUB_REPOSITORIES_INVALID");
        return {
          status: "SUCCEEDED",
          items: repositories.slice(0, 100).flatMap((repository): ActionItem[] => {
            if (!repository || typeof repository !== "object") return [];
            const value = repository as Record<string, unknown>;
            const id = safeText(value.id, 120);
            const label = safeText(value.full_name, 240);
            if (!id || !label) return [];
            const flags = [
              value.private === true ? "private" : "public",
              value.archived === true ? "archived" : "active",
            ];
            return [{ id, label, detail: flags.join(" · ") }];
          }),
        };
      }
      throw new Error("INTEGRATION_ACTION_KIND_MISMATCH");
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "ACTION_FAILED";
      return { status: "FAILED", items: [{ id: "error", label: code }] };
    }
  };
}

export function createNodeIntegrationMutationExecutor(
  configuration: { allowedHosts: string[]; allowPrivateNetwork: boolean },
  dependencies: {
    resolve?: typeof resolveHost;
    https?: typeof httpsCall;
    ssh?: typeof executeSsh;
  } = {},
) {
  const resolveTarget = dependencies.resolve ?? resolveHost;
  const callHttps = dependencies.https ?? httpsCall;
  const callSsh = dependencies.ssh ?? executeSsh;
  const allowedHosts = new Set(
    configuration.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
  );
  return async (input: {
    endpointUrl?: string;
    endpoint?:
      | { transport: "HTTPS"; url: string }
      | { transport: "SSH"; host: string; port: number; username: string };
    credential: string;
    mutation: ExecutableIntegrationMutation;
  }): Promise<
    { state: "SUCCEEDED" } | { state: "FAILED" | "OUTCOME_UNKNOWN"; failureCode: string }
  > => {
    if (!input.credential) return { state: "FAILED", failureCode: "CREDENTIAL_REQUIRED" };
    if (input.mutation.kind === "SSH_RUN_REGISTERED_OPERATION") {
      if (input.endpoint?.transport !== "SSH")
        return { state: "FAILED", failureCode: "SSH_ENDPOINT_REQUIRED" };
      let resolved: Awaited<ReturnType<typeof resolveHost>>;
      try {
        resolved = await resolveTarget(
          input.endpoint.host,
          allowedHosts,
          configuration.allowPrivateNetwork,
        );
      } catch (error) {
        return {
          state: "FAILED",
          failureCode: error instanceof Error ? error.message.slice(0, 64) : "ROUTE_UNAVAILABLE",
        };
      }
      try {
        const result = await callSsh({
          address: resolved.address,
          port: input.endpoint.port,
          username: input.endpoint.username,
          privateKey: input.credential,
          hostKeySha256: input.mutation.hostKeySha256,
          command: sshCommand(input.mutation.operation),
        });
        return result.code === 0
          ? { state: "SUCCEEDED" }
          : { state: "FAILED", failureCode: "REMOTE_REJECTED" };
      } catch (error) {
        return error instanceof Error && error.message === "HOST_KEY_MISMATCH"
          ? { state: "FAILED", failureCode: "HOST_KEY_MISMATCH" }
          : { state: "OUTCOME_UNKNOWN", failureCode: "INTERRUPTED_OUTCOME_UNKNOWN" };
      }
    }
    const endpointUrl =
      input.endpoint?.transport === "HTTPS" ? input.endpoint.url : input.endpointUrl;
    if (!endpointUrl) return { state: "FAILED", failureCode: "HTTPS_ENDPOINT_REQUIRED" };
    const base = new URL(endpointUrl);
    if (base.protocol !== "https:") return { state: "FAILED", failureCode: "HTTPS_REQUIRED" };
    let resolved: Awaited<ReturnType<typeof resolveHost>>;
    try {
      resolved = await resolveTarget(
        base.hostname,
        allowedHosts,
        configuration.allowPrivateNetwork,
      );
    } catch (error) {
      return {
        state: "FAILED",
        failureCode: error instanceof Error ? error.message.slice(0, 64) : "ROUTE_UNAVAILABLE",
      };
    }
    const mcpUrl = new URL(base);
    if (input.mutation.kind === "MCP_CALL_REGISTERED_TOOL") {
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${input.credential}`,
        "content-type": "application/json",
        "user-agent": "agent-world-integration-mutation/1",
      };
      try {
        const initialize = await callHttps(
          mcpUrl,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({
            jsonrpc: "2.0",
            id: "initialize",
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "agent-world", version: "1" },
            },
          }),
        );
        if (initialize.status < 200 || initialize.status >= 300)
          return initialize.status >= 500
            ? { state: "OUTCOME_UNKNOWN", failureCode: "REMOTE_OUTCOME_UNKNOWN" }
            : { state: "FAILED", failureCode: "REMOTE_REJECTED" };
        if (initialize.sessionId) headers["mcp-session-id"] = initialize.sessionId;
        const initialized = await callHttps(
          mcpUrl,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        );
        if (initialized.status < 200 || initialized.status >= 300)
          return initialized.status >= 500
            ? { state: "OUTCOME_UNKNOWN", failureCode: "REMOTE_OUTCOME_UNKNOWN" }
            : { state: "FAILED", failureCode: "REMOTE_REJECTED" };
        const response = await callHttps(
          mcpUrl,
          resolved.address,
          resolved.family,
          "POST",
          headers,
          JSON.stringify({
            jsonrpc: "2.0",
            id: "tool-call",
            method: "tools/call",
            params: { name: input.mutation.toolName, arguments: input.mutation.fixedArguments },
          }),
        );
        if (response.status < 200 || response.status >= 300)
          return response.status >= 500
            ? { state: "OUTCOME_UNKNOWN", failureCode: "REMOTE_OUTCOME_UNKNOWN" }
            : { state: "FAILED", failureCode: "REMOTE_REJECTED" };
        const payload = jsonPayload(response);
        if (payload.error !== undefined)
          return { state: "FAILED", failureCode: "MCP_TOOL_REJECTED" };
        if (!payload.result || typeof payload.result !== "object")
          return { state: "OUTCOME_UNKNOWN", failureCode: "MCP_RESULT_INVALID" };
        return { state: "SUCCEEDED" };
      } catch {
        return { state: "OUTCOME_UNKNOWN", failureCode: "INTERRUPTED_OUTCOME_UNKNOWN" };
      }
    }
    const githubMutation = input.mutation;
    const url = new URL(base.origin);
    url.pathname = `/repos/${encodeURIComponent(input.mutation.owner)}/${encodeURIComponent(
      githubMutation.repository,
    )}/actions/workflows/${encodeURIComponent(githubMutation.workflowId)}/dispatches`;
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.credential}`,
      "content-type": "application/json",
      "user-agent": "agent-world-integration-mutation/1",
      "x-github-api-version": "2026-03-10",
    };
    let response: Awaited<ReturnType<typeof httpsCall>>;
    try {
      response = await callHttps(
        url,
        resolved.address,
        resolved.family,
        "POST",
        headers,
        JSON.stringify({ ref: githubMutation.ref, return_run_details: true }),
      );
    } catch {
      return { state: "OUTCOME_UNKNOWN", failureCode: "INTERRUPTED_OUTCOME_UNKNOWN" };
    }
    if (response.status !== 200 && response.status !== 204) {
      return response.status >= 500
        ? { state: "OUTCOME_UNKNOWN", failureCode: "REMOTE_OUTCOME_UNKNOWN" }
        : { state: "FAILED", failureCode: "REMOTE_REJECTED" };
    }
    return { state: "SUCCEEDED" };
  };
}

export function createNodeIntegrationProbe(configuration: {
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
}) {
  const allowedHosts = new Set(
    configuration.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
  );
  return async (target: ProbeTarget, credential?: string): Promise<ProbeResult> => {
    try {
      if (!target.isEnabled) throw new Error("INTEGRATION_DISABLED");
      if (target.endpoint.transport === "SSH") {
        const resolved = await resolveHost(
          target.endpoint.host,
          allowedHosts,
          configuration.allowPrivateNetwork,
        );
        await sshBanner(resolved.address, target.endpoint.port);
        return { health: "READY", code: "SSH_BANNER_OK" };
      }
      const url = new URL(target.endpoint.url);
      if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
      const resolved = await resolveHost(
        url.hostname,
        allowedHosts,
        configuration.allowPrivateNetwork,
      );
      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": "agent-world-integration-probe/1",
      };
      let method: "GET" | "POST" = "GET";
      let body: string | undefined;
      if (target.kind === "MCP") {
        method = "POST";
        body = JSON.stringify({
          jsonrpc: "2.0",
          id: "health",
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "agent-world", version: "1" },
          },
        });
        headers["content-type"] = "application/json";
        headers.accept = "application/json, text/event-stream";
        if (credential) headers.authorization = `Bearer ${credential}`;
      } else if (target.kind === "N8N") {
        url.pathname = "/healthz/readiness";
        url.search = "";
        if (credential) headers["x-n8n-api-key"] = credential;
      } else if (target.kind === "GITHUB") {
        if (!credential) throw new Error("CREDENTIAL_REQUIRED");
        headers.authorization = `Bearer ${credential}`;
        url.pathname = "/user";
        url.search = "";
        headers.accept = "application/vnd.github+json";
        headers["x-github-api-version"] = "2026-03-10";
      }
      const response = await httpsCall(
        url,
        resolved.address,
        resolved.family,
        method,
        headers,
        body,
      );
      if (response.status < 200 || response.status >= 300) throw new Error("REMOTE_UNHEALTHY");
      if (target.kind === "MCP") {
        const payload = response.contentType.includes("text/event-stream")
          ? response.body
              .split(/\r?\n/)
              .find((line) => line.startsWith("data:"))
              ?.slice(5)
              .trim()
          : response.body;
        if (!payload) throw new Error("MCP_INITIALIZE_INVALID");
        const parsed = JSON.parse(payload) as { jsonrpc?: unknown; result?: unknown };
        if (parsed.jsonrpc !== "2.0" || parsed.result === undefined)
          throw new Error("MCP_INITIALIZE_INVALID");
      }
      return { health: "READY", code: `${target.kind}_PROBE_OK` };
    } catch (error) {
      return {
        health: "ERROR",
        code: error instanceof Error ? error.message.slice(0, 120) : "PROBE_FAILED",
      };
    }
  };
}
