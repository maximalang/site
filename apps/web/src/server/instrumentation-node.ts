import { startApplicationRuntime } from "./application-runtime";
import { createProductionRuntime } from "./production-runtime";

export async function registerNodeRuntime(): Promise<void> {
  const ready = await startApplicationRuntime(() => createProductionRuntime());
  if (!ready) {
    console.error(
      JSON.stringify({ component: "application-runtime", event: "startup_unavailable" }),
    );
  }
}
