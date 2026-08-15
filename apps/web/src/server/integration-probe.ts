import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, connect, isIP } from "node:net";

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
  return new Promise<{ status: number; body: string; contentType: string }>((resolve, reject) => {
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
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (content.length < 32_768) content += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: content,
            contentType: String(response.headers["content-type"] ?? ""),
          }),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("PROBE_TIMEOUT")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function sshBanner(address: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host: address, port, timeout: 5_000 });
    let banner = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      banner += chunk;
      if (banner.includes("\n") || banner.length > 255) {
        socket.destroy();
        banner.startsWith("SSH-") ? resolve() : reject(new Error("SSH_BANNER_INVALID"));
      }
    });
    socket.on("timeout", () => socket.destroy(new Error("PROBE_TIMEOUT")));
    socket.on("error", reject);
    socket.on("end", () =>
      banner.startsWith("SSH-") ? resolve() : reject(new Error("SSH_BANNER_INVALID")),
    );
  });
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
