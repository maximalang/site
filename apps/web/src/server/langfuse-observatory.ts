import { randomBytes } from "node:crypto";
import type { OperationsReadModel } from "@agent-world/read-model";

type RuntimeEnvironment = Record<string, string | undefined>;

type FetchLike = typeof fetch;

export type LangfuseTelemetryConfig = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  pollMs: number;
  timeoutMs: number;
};

export type ObservatoryExporter = {
  export(snapshot: OperationsReadModel): Promise<void>;
};

type ProjectionEvent =
  | { event: "projection_succeeded"; generatedAt: string }
  | { event: "projection_failed" };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseLangfuseTelemetryConfig(
  environment: RuntimeEnvironment,
): LangfuseTelemetryConfig | undefined {
  const baseUrl = environment.AGENT_WORLD_LANGFUSE_BASE_URL?.trim();
  const publicKey = environment.AGENT_WORLD_LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = environment.AGENT_WORLD_LANGFUSE_SECRET_KEY?.trim();
  const configured = [baseUrl, publicKey, secretKey].some(Boolean);
  if (!configured) return undefined;
  if (!baseUrl || !publicKey || !secretKey) {
    throw new Error("Langfuse telemetry configuration is incomplete");
  }
  if (
    publicKey.length > 4_096 ||
    secretKey.length > 4_096 ||
    publicKey.includes(":") ||
    secretKey.includes(":")
  ) {
    throw new Error("Langfuse API keys violate the bounded Basic-auth contract");
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("AGENT_WORLD_LANGFUSE_BASE_URL must be an absolute URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(
      "AGENT_WORLD_LANGFUSE_BASE_URL must be an origin without credentials or query data",
    );
  }
  if (url.protocol !== "https:") {
    const explicitlyPrivate =
      url.protocol === "http:" &&
      (isLoopback(url.hostname) ||
        environment.AGENT_WORLD_LANGFUSE_PLAINTEXT_ACK === "private-network");
    if (!explicitlyPrivate) {
      throw new Error(
        "Langfuse telemetry requires HTTPS or an explicit private-network acknowledgement",
      );
    }
  }

  return {
    baseUrl: url.origin,
    publicKey,
    secretKey,
    pollMs: parseBoundedInteger(
      environment.AGENT_WORLD_LANGFUSE_POLL_MS,
      30_000,
      5_000,
      900_000,
      "AGENT_WORLD_LANGFUSE_POLL_MS",
    ),
    timeoutMs: parseBoundedInteger(
      environment.AGENT_WORLD_LANGFUSE_TIMEOUT_MS,
      5_000,
      1_000,
      30_000,
      "AGENT_WORLD_LANGFUSE_TIMEOUT_MS",
    ),
  };
}

function stringAttribute(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

function integerAttribute(key: string, value: number) {
  return { key, value: { intValue: String(value) } };
}

function doubleAttribute(key: string, value: number) {
  return { key, value: { doubleValue: value } };
}

function buildSnapshotPayload(snapshot: OperationsReadModel, observedAt: Date): unknown {
  const observatory = snapshot.observatory;
  const routeSignalCount = observatory.routeSignals.length;
  const availableRouteCount = observatory.routeSignals.filter(
    (signal) => signal.isAvailable,
  ).length;
  const freshRouteCount = observatory.routeSignals.filter((signal) => signal.isFresh).length;
  const attributes = [
    stringAttribute("agent_world.generated_at", snapshot.generatedAt),
    integerAttribute("agent_world.runs.total", observatory.runs.total),
    integerAttribute("agent_world.runs.completed", observatory.runs.completed),
    integerAttribute("agent_world.runs.failed", observatory.runs.failed),
    integerAttribute("agent_world.tokens.input", observatory.tokens.input),
    integerAttribute("agent_world.tokens.cached_input", observatory.tokens.cachedInput),
    integerAttribute("agent_world.tokens.output", observatory.tokens.output),
    integerAttribute("agent_world.context.estimated_tokens", observatory.context.estimatedTokens),
    integerAttribute("agent_world.context.budget_tokens", observatory.context.budgetTokens),
    doubleAttribute("agent_world.context.pressure", observatory.context.pressure),
    stringAttribute("agent_world.monetary_cost.status", observatory.monetaryCost.status),
    integerAttribute("agent_world.routes.total", routeSignalCount),
    integerAttribute("agent_world.routes.available", availableRouteCount),
    integerAttribute("agent_world.routes.fresh", freshRouteCount),
  ];
  if (observatory.monetaryCost.status === "ESTIMATED") {
    attributes.push(
      doubleAttribute("agent_world.monetary_cost.amount_usd", observatory.monetaryCost.amountUsd),
      integerAttribute("agent_world.monetary_cost.job_count", observatory.monetaryCost.jobCount),
    );
  }

  const unixNano = String(BigInt(observedAt.getTime()) * 1_000_000n);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", "agent-world"),
            stringAttribute("service.namespace", "observatory"),
            stringAttribute("telemetry.projection", "langfuse-otlp"),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "agent-world-observatory", version: "1" },
            spans: [
              {
                traceId: randomBytes(16).toString("hex"),
                spanId: randomBytes(8).toString("hex"),
                name: "agent-world.observatory.snapshot",
                kind: 1,
                startTimeUnixNano: unixNano,
                endTimeUnixNano: unixNano,
                attributes,
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

export class LangfuseOtlpExporter implements ObservatoryExporter {
  readonly #endpoint: string;
  readonly #authorization: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(config: LangfuseTelemetryConfig, fetchImpl: FetchLike = fetch) {
    this.#endpoint = new URL("/api/public/otel/v1/traces", config.baseUrl).toString();
    this.#authorization = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`;
    this.#timeoutMs = config.timeoutMs;
    this.#fetch = fetchImpl;
  }

  async export(snapshot: OperationsReadModel): Promise<void> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: this.#authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildSnapshotPayload(snapshot, new Date())),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Langfuse OTLP export failed with status ${response.status}`);
    }
  }
}

export class LangfuseObservatorySupervisor {
  readonly #readOperations: () => Promise<OperationsReadModel>;
  readonly #exporter: ObservatoryExporter;
  readonly #pollMs: number;
  readonly #record: (event: ProjectionEvent) => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  #inFlight: Promise<void> | undefined;

  constructor(options: {
    readOperations: () => Promise<OperationsReadModel>;
    exporter: ObservatoryExporter;
    pollMs: number;
    record?: (event: ProjectionEvent) => void;
  }) {
    this.#readOperations = options.readOperations;
    this.#exporter = options.exporter;
    this.#pollMs = options.pollMs;
    this.#record = options.record ?? (() => undefined);
  }

  start(): void {
    if (this.#timer) return;
    void this.runOnce();
    this.#timer = setInterval(() => void this.runOnce(), this.#pollMs);
    this.#timer.unref?.();
  }

  async runOnce(): Promise<void> {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = (async () => {
      try {
        const snapshot = await this.#readOperations();
        await this.#exporter.export(snapshot);
        this.#record({ event: "projection_succeeded", generatedAt: snapshot.generatedAt });
      } catch {
        this.#record({ event: "projection_failed" });
      }
    })();
    try {
      await this.#inFlight;
    } finally {
      this.#inFlight = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#inFlight;
  }
}
