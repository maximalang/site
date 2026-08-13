export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeRuntime } = await import("./src/server/instrumentation-node");
    await registerNodeRuntime();
  }
}
