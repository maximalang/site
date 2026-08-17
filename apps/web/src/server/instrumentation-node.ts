import type { ApplicationRuntime } from "./application-runtime";
import { startApplicationRuntime } from "./application-runtime";
import {
  LangfuseObservatorySupervisor,
  LangfuseOtlpExporter,
  parseLangfuseTelemetryConfig,
} from "./langfuse-observatory";
import { createProductionRuntime } from "./production-runtime";

function recordLangfuseProjection(event: unknown): void {
  try {
    console.info(JSON.stringify({ component: "langfuse-observatory", event }));
  } catch {
    // Telemetry diagnostics must never interrupt the application runtime.
  }
}

async function createInstrumentedProductionRuntime(): Promise<ApplicationRuntime> {
  const runtime = await createProductionRuntime();
  let config;
  try {
    config = parseLangfuseTelemetryConfig(process.env);
  } catch {
    recordLangfuseProjection({ event: "configuration_rejected" });
    return runtime;
  }
  if (!config) return runtime;

  const supervisor = new LangfuseObservatorySupervisor({
    readOperations: () => runtime.readOperations(),
    exporter: new LangfuseOtlpExporter(config),
    pollMs: config.pollMs,
    record: recordLangfuseProjection,
  });
  supervisor.start();
  recordLangfuseProjection({ event: "projection_started" });

  return {
    ...runtime,
    stop: async () => {
      await supervisor.stop();
      await runtime.stop();
    },
  };
}

export async function registerNodeRuntime(): Promise<void> {
  const ready = await startApplicationRuntime(createInstrumentedProductionRuntime);
  if (!ready) {
    console.error(
      JSON.stringify({ component: "application-runtime", event: "startup_unavailable" }),
    );
  }
}
