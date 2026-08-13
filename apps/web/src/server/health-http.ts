import { getApplicationRuntime } from "./application-runtime";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function createLivenessHandler(): () => Promise<Response> {
  return async () => Response.json({ status: "alive" }, { headers: RESPONSE_HEADERS, status: 200 });
}

export function createReadinessHandler(probe: () => Promise<void>): () => Promise<Response> {
  return async () => {
    try {
      await probe();
      return Response.json({ status: "ready" }, { headers: RESPONSE_HEADERS, status: 200 });
    } catch {
      return Response.json({ status: "unavailable" }, { headers: RESPONSE_HEADERS, status: 503 });
    }
  };
}

async function probeApplicationRuntime(): Promise<void> {
  const runtime = getApplicationRuntime();
  if (!runtime) throw new Error("Application runtime is unavailable");
  await runtime.probeReady();
}

export const GET_LIVENESS = createLivenessHandler();
export const GET_READINESS = createReadinessHandler(probeApplicationRuntime);
