import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Codex } from "@openai/codex-sdk";
import { CodexExecutionRequestSchema, OpenAiCodexSdkRunner } from "../dist/index.js";

const ACK = "AGENT_WORLD_CODEX_LIVE_TEST_ACK";
if (process.env[ACK] !== "isolated") {
  throw new Error(`${ACK}=isolated is required; this verifier launches the packaged Codex CLI`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-world-codex-live-"));
const repository = join(temporaryRoot, "repository");
const codexHome = join(temporaryRoot, "codex-home");
await mkdir(join(repository, ".git"), { recursive: true });
await mkdir(codexHome);
const requests = [];
let responseNumber = 0;
const responseText = ["Official SDK bootstrap passed.", "Official SDK resume passed."];

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });
  request.on("end", () => {
    const parsed = JSON.parse(body);
    requests.push({
      authorization: request.headers.authorization,
      body: parsed,
    });
    const current = responseNumber++;
    if (current === 2) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "isolated upstream failure" } }));
      return;
    }
    const responseId = `response-live-${current + 1}`;
    const messageId = `message-live-${current + 1}`;
    const events = [
      { type: "response.created", response: { id: responseId } },
      {
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          id: messageId,
          content: [{ type: "output_text", text: responseText[current] }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: responseId,
          usage: {
            input_tokens: 12,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens: 10,
            output_tokens_details: { reasoning_tokens: 1 },
            total_tokens: 22,
          },
        },
      },
    ];
    response.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    for (const event of events) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not bind TCP");
const baseUrl = `http://127.0.0.1:${address.port}/v1`;
const environment = Object.fromEntries(
  ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE"]
    .map((key) => [key, process.env[key]])
    .filter((entry) => entry[1]),
);
environment.CODEX_HOME = codexHome;
const config = {
  model_provider: "mock",
  model_providers: {
    mock: {
      name: "Isolated mock provider",
      base_url: baseUrl,
      wire_api: "responses",
      supports_websockets: false,
      request_max_retries: 0,
      stream_max_retries: 0,
    },
  },
  features: { plugins: false },
};

try {
  const client = new Codex({ apiKey: "isolated-test-key", config, env: environment });
  const thread = client.startThread({
    approvalPolicy: "never",
    model: "mock-model",
    networkAccessEnabled: false,
    sandboxMode: "read-only",
    workingDirectory: repository,
  });
  const bootstrapEvents = [];
  for await (const event of (await thread.runStreamed("Bootstrap official SDK thread.")).events) {
    bootstrapEvents.push(event);
  }
  if (!thread.id || !bootstrapEvents.some(({ type }) => type === "turn.completed")) {
    throw new Error("Official SDK did not start a resumable thread");
  }

  const normalizedEvents = [];
  const runner = new OpenAiCodexSdkRunner({
    createClient: () => ({
      resumeThread: (threadId, options) => {
        const resumed = client.resumeThread(threadId, options);
        return { runStreamed: (prompt, turnOptions) => resumed.runStreamed(prompt, turnOptions) };
      },
    }),
    environment,
  });
  const resumeRequest = CodexExecutionRequestSchema.parse({
    schemaVersion: 1,
    runId: "run_11111111-1111-1111-1111-111111111111",
    taskId: "task_22222222-2222-2222-2222-222222222222",
    agentId: "agent_33333333-3333-3333-3333-333333333333",
    bindingId: "binding_44444444-4444-4444-4444-444444444444",
    routeId: "route_55555555-5555-5555-5555-555555555555",
    accountId: "account_66666666-6666-6666-6666-666666666666",
    sessionId: "session_77777777-7777-7777-7777-777777777777",
    codexThreadId: thread.id,
    idempotencyKey: "codex:live:resume",
    prompt: "Resume official SDK thread.",
    policy: {
      workingDirectory: repository,
      sandbox: "READ_ONLY",
      approvalPolicy: "NEVER",
      networkAccess: false,
      timeoutMs: 30_000,
      model: "mock-model",
    },
  });
  await runner.run(resumeRequest, async (event) => normalizedEvents.push(event));
  const failureEvents = [];
  let failureCode;
  try {
    await runner.run(
      CodexExecutionRequestSchema.parse({
        ...resumeRequest,
        runId: "run_88888888-8888-8888-8888-888888888888",
        idempotencyKey: "codex:live:failure",
        prompt: "Prove official SDK failure normalization.",
      }),
      async (event) => failureEvents.push(event),
    );
  } catch (error) {
    failureCode = error?.code;
  }
  if (
    requests.length !== 3 ||
    requests.some(({ authorization }) => authorization !== "Bearer isolated-test-key") ||
    !JSON.stringify(requests[0].body).includes("Bootstrap official SDK thread.") ||
    !JSON.stringify(requests[1].body).includes("Resume official SDK thread.") ||
    normalizedEvents.map(({ eventType }) => eventType).join(",") !==
      "RUN_STARTED,ITEM_COMPLETED,FINAL_OUTPUT,USAGE_RECORDED,RUN_COMPLETED" ||
    normalizedEvents.find(({ eventType }) => eventType === "FINAL_OUTPUT")?.content !==
      responseText[1] ||
    normalizedEvents.find(({ eventType }) => eventType === "USAGE_RECORDED")?.usage
      .cachedInputTokens !== 4 ||
    failureCode !== "EXECUTION_FAILED" ||
    failureEvents.at(-1)?.eventType !== "RUN_FAILED" ||
    failureEvents.at(-1)?.failureCode !== "EXECUTION_FAILED"
  ) {
    throw new Error(
      `Pinned official SDK live evidence was incomplete: ${JSON.stringify({
        requests: requests.length,
        authorization: requests.map(
          ({ authorization }) => authorization === "Bearer isolated-test-key",
        ),
        prompts: [
          JSON.stringify(requests[0]?.body).includes("Bootstrap official SDK thread."),
          JSON.stringify(requests[1]?.body).includes("Resume official SDK thread."),
        ],
        eventTypes: normalizedEvents.map(({ eventType }) => eventType),
        finalOutput: normalizedEvents.find(({ eventType }) => eventType === "FINAL_OUTPUT")
          ?.content,
        usage: normalizedEvents.find(({ eventType }) => eventType === "USAGE_RECORDED")?.usage,
        failureCode,
        failureEvents,
      })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", sdkVersion: "0.147.0", cliVersion: "0.147.0", requests: requests.length, resumed: true, normalizedEvents: normalizedEvents.length, usage: true, failure: "EXECUTION_FAILED" })}\n`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await delay(250);
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
