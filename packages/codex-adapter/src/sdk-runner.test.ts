import { describe, expect, it, vi } from "vitest";
import { CodexExecutionError, CodexExecutionRequestSchema } from "./contract.js";
import { OpenAiCodexSdkRunner } from "./sdk-runner.js";

const request = CodexExecutionRequestSchema.parse({
  schemaVersion: 1,
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_77777777-7777-7777-7777-777777777777",
  routeId: "route_88888888-8888-8888-8888-888888888888",
  accountId: "account_44444444-4444-4444-4444-444444444444",
  sessionId: "session_55555555-5555-5555-5555-555555555555",
  codexThreadId: "thread-opaque-1",
  idempotencyKey: "codex:run-1",
  prompt: "Inspect the repository.",
  policy: {
    workingDirectory: "C:/workspace/project",
    sandbox: "WORKSPACE_WRITE",
    approvalPolicy: "ON_REQUEST",
    networkAccess: false,
    timeoutMs: 60_000,
    model: "gpt-5.6-codex",
    reasoningEffort: "HIGH",
  },
});

async function* eventStream(events: unknown[]) {
  for (const event of events) yield event;
}

describe("OpenAiCodexSdkRunner", () => {
  it("maps official SDK events without leaking raw command output or process secrets", async () => {
    const resumeThread = vi.fn(() => ({
      runStreamed: vi.fn(async () => ({
        events: eventStream([
          { type: "turn.started" },
          {
            type: "item.completed",
            item: { id: "message-1", type: "agent_message", text: "Verified." },
          },
          {
            type: "item.completed",
            item: {
              id: "command-1",
              type: "command_execution",
              command: "opaque command",
              aggregated_output: "provider-secret-must-not-leak",
              status: "completed",
              exit_code: 0,
            },
          },
          {
            type: "turn.completed",
            usage: {
              input_tokens: 12,
              cached_input_tokens: 2,
              cache_write_input_tokens: 0,
              output_tokens: 4,
              reasoning_output_tokens: 1,
            },
          },
        ]),
      })),
    }));
    let receivedEnvironment: Record<string, string> | undefined;
    const runner = new OpenAiCodexSdkRunner({
      createClient: (options) => {
        receivedEnvironment = options.env;
        return { resumeThread };
      },
      environment: {
        PATH: "C:/bin",
        CODEX_HOME: "C:/codex",
        OPENAI_API_KEY: "provider-secret-must-not-leak",
        UNRELATED_SECRET: "do-not-inherit",
      },
      now: () => "2026-08-13T12:00:00.000Z",
    });
    const emitted: unknown[] = [];

    await runner.run(request, async (event) => emitted.push(event));

    expect(receivedEnvironment).toEqual({ PATH: "C:/bin", CODEX_HOME: "C:/codex" });
    expect(resumeThread).toHaveBeenCalledWith("thread-opaque-1", {
      approvalPolicy: "on-request",
      model: "gpt-5.6-codex",
      modelReasoningEffort: "high",
      networkAccessEnabled: false,
      sandboxMode: "workspace-write",
      workingDirectory: "C:/workspace/project",
    });
    expect(emitted.map((event) => (event as { eventType: string }).eventType)).toEqual([
      "RUN_STARTED",
      "ITEM_COMPLETED",
      "ITEM_COMPLETED",
      "FINAL_OUTPUT",
      "USAGE_RECORDED",
      "RUN_COMPLETED",
    ]);
    expect(JSON.stringify(emitted)).not.toContain("provider-secret-must-not-leak");
    expect(emitted[3]).toMatchObject({ eventType: "FINAL_OUTPUT", content: "Verified." });
  });

  it("normalizes raw SDK failures without reflecting their messages", async () => {
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async () => ({
            events: eventStream([
              { type: "turn.started" },
              { type: "turn.failed", error: { message: "token provider-secret" } },
            ]),
          }),
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
    });
    const emitted: unknown[] = [];

    await expect(runner.run(request, async (event) => emitted.push(event))).rejects.toEqual(
      new CodexExecutionError("EXECUTION_FAILED"),
    );
    expect(JSON.stringify(emitted)).not.toContain("provider-secret");
    expect(emitted.at(-1)).toMatchObject({
      eventType: "RUN_FAILED",
      failureCode: "EXECUTION_FAILED",
    });
  });

  it("fails closed on malformed SDK events", async () => {
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async () => ({ events: eventStream([{ type: "invented.event" }]) }),
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
    });

    await expect(runner.run(request, async () => undefined)).rejects.toMatchObject({
      code: "MALFORMED_EVENT",
    });
  });

  it("normalizes timeouts without reflecting thrown SDK data", async () => {
    const timeout = new AbortController();
    timeout.abort();
    const emitted: unknown[] = [];
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async (_prompt, options) => {
            if (!options.signal.aborted) throw new Error("wrong timeout signal");
            throw new Error("token provider-secret");
          },
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
      timeoutSignal: () => timeout.signal,
    });

    await expect(runner.run(request, async (event) => emitted.push(event))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(JSON.stringify(emitted)).not.toContain("provider-secret");
  });

  it("normalizes caller cancellation without reflecting thrown SDK data", async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    const emitted: unknown[] = [];
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async (_prompt, options) => {
            if (!options.signal.aborted) throw new Error("wrong cancellation signal");
            throw new Error("token provider-secret");
          },
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
    });

    await expect(
      runner.run(request, async (event) => emitted.push(event), cancellation.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(emitted.at(-1)).toMatchObject({ eventType: "RUN_FAILED", failureCode: "CANCELLED" });
    expect(JSON.stringify(emitted)).not.toContain("provider-secret");
  });

  it("stops immediately when the durable event sink rejects", async () => {
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async () => ({ events: eventStream([{ type: "turn.started" }]) }),
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
    });
    const emit = vi.fn(async () => {
      throw new Error("private database locator");
    });

    await expect(runner.run(request, emit)).rejects.toEqual(
      new CodexExecutionError("DISPATCH_UNAVAILABLE"),
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores resumed thread history before the new turn starts", async () => {
    const emitted: unknown[] = [];
    const runner = new OpenAiCodexSdkRunner({
      createClient: () => ({
        resumeThread: () => ({
          runStreamed: async () => ({
            events: eventStream([
              {
                type: "item.completed",
                item: { id: "history-message", type: "agent_message", text: "Old response." },
              },
              { type: "turn.started" },
              {
                type: "item.completed",
                item: { id: "new-message", type: "agent_message", text: "New response." },
              },
              {
                type: "turn.completed",
                usage: { input_tokens: 24, cached_input_tokens: 4, output_tokens: 20 },
              },
            ]),
          }),
        }),
      }),
      environment: {},
      now: () => "2026-08-13T12:00:00.000Z",
    });

    await runner.run(request, async (event) => emitted.push(event));

    expect(emitted).toHaveLength(5);
    expect(JSON.stringify(emitted)).not.toContain("Old response.");
    expect(emitted).toContainEqual(
      expect.objectContaining({ eventType: "FINAL_OUTPUT", content: "New response." }),
    );
  });
});
