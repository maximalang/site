import { Codex } from "@openai/codex-sdk";
import * as z from "zod";
import {
  CodexExecutionError,
  type CodexExecutionEvent,
  CodexExecutionEventSchema,
  type CodexExecutionFailureCode,
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
} from "./contract.js";

type SdkThreadOptions = {
  approvalPolicy: "never" | "on-request" | "untrusted";
  model?: string;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  networkAccessEnabled: boolean;
  sandboxMode: "read-only" | "workspace-write";
  workingDirectory: string;
};

type SdkThread = {
  runStreamed(
    prompt: string,
    options: { signal: AbortSignal },
  ): Promise<{ events: AsyncIterable<unknown> }>;
};

type SdkClient = {
  resumeThread(threadId: string, options: SdkThreadOptions): SdkThread;
};

type CreateSdkClient = (options: { env: Record<string, string> }) => SdkClient;

type WithoutEventEnvelope<T> = T extends unknown ? Omit<T, "sequence" | "occurredAt"> : never;
type CodexExecutionEventDraft = WithoutEventEnvelope<CodexExecutionEvent>;

const RawItemSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).max(512), type: z.literal("agent_message"), text: z.string() }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("reasoning") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("command_execution") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("file_change") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("mcp_tool_call") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("web_search") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("todo_list") }),
  z.object({ id: z.string().min(1).max(512), type: z.literal("error") }),
]);

const RawSdkEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.started"), thread_id: z.string().min(1).max(512) }),
  z.object({ type: z.literal("turn.started") }),
  z.object({ type: z.literal("item.started"), item: RawItemSchema }),
  z.object({ type: z.literal("item.updated"), item: RawItemSchema }),
  z.object({ type: z.literal("item.completed"), item: RawItemSchema }),
  z.object({
    type: z.literal("turn.completed"),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      cached_input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    }),
  }),
  z.object({ type: z.literal("turn.failed"), error: z.object({ message: z.string() }) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

const ENVIRONMENT_ALLOWLIST = [
  ["PATH", "PATH"],
  ["CODEX_HOME", "CODEX_HOME"],
  ["HOME", "HOME"],
  ["USERPROFILE", "USERPROFILE"],
  ["SYSTEMROOT", "SystemRoot"],
  ["TEMP", "TEMP"],
  ["TMP", "TMP"],
  ["CODEX_CA_CERTIFICATE", "CODEX_CA_CERTIFICATE"],
  ["SSL_CERT_FILE", "SSL_CERT_FILE"],
  ["HTTPS_PROXY", "HTTPS_PROXY"],
  ["HTTP_PROXY", "HTTP_PROXY"],
  ["NO_PROXY", "NO_PROXY"],
] as const;

export function buildCodexEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [lookupName, outputName] of ENVIRONMENT_ALLOWLIST) {
    const matchingKey = Object.keys(environment).find((key) => key.toUpperCase() === lookupName);
    const value = matchingKey === undefined ? undefined : environment[matchingKey];
    if (value) result[outputName] = value;
  }
  return result;
}

export interface CodexExecutionRunner {
  run(
    request: unknown,
    emit: (event: CodexExecutionEvent) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
}

function sdkThreadOptions(request: CodexExecutionRequest): SdkThreadOptions {
  return {
    approvalPolicy: request.policy.approvalPolicy.toLowerCase().replace("_", "-") as
      | "never"
      | "on-request"
      | "untrusted",
    ...(request.policy.model === undefined ? {} : { model: request.policy.model }),
    ...(request.policy.reasoningEffort === undefined
      ? {}
      : {
          modelReasoningEffort: request.policy.reasoningEffort.toLowerCase() as NonNullable<
            SdkThreadOptions["modelReasoningEffort"]
          >,
        }),
    networkAccessEnabled: request.policy.networkAccess,
    sandboxMode: request.policy.sandbox === "READ_ONLY" ? "read-only" : "workspace-write",
    workingDirectory: request.policy.workingDirectory,
  };
}

const itemType = (type: z.infer<typeof RawItemSchema>["type"]) =>
  ({
    agent_message: "MESSAGE",
    command_execution: "COMMAND",
    error: "ERROR",
    file_change: "FILE_CHANGE",
    mcp_tool_call: "MCP_CALL",
    reasoning: "REASONING",
    todo_list: "TODO",
    web_search: "WEB_SEARCH",
  })[type] as
    | "MESSAGE"
    | "COMMAND"
    | "ERROR"
    | "FILE_CHANGE"
    | "MCP_CALL"
    | "REASONING"
    | "TODO"
    | "WEB_SEARCH";

export class OpenAiCodexSdkRunner implements CodexExecutionRunner {
  private readonly createClient: CreateSdkClient;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly now: () => string;
  private readonly timeoutSignal: (timeoutMs: number) => AbortSignal;

  constructor(
    options: {
      createClient?: CreateSdkClient;
      environment?: Readonly<Record<string, string | undefined>>;
      now?: () => string;
      timeoutSignal?: (timeoutMs: number) => AbortSignal;
    } = {},
  ) {
    this.createClient =
      options.createClient ??
      ((clientOptions) => {
        const codex = new Codex({
          env: clientOptions.env,
          config: { forced_login_method: "chatgpt" },
        });
        return {
          resumeThread: (threadId, threadOptions) => {
            const thread = codex.resumeThread(threadId, threadOptions);
            return {
              runStreamed: (prompt, turnOptions) => thread.runStreamed(prompt, turnOptions),
            };
          },
        };
      });
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeoutSignal = options.timeoutSignal ?? AbortSignal.timeout;
  }

  async run(
    requestInput: unknown,
    emit: (event: CodexExecutionEvent) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const request = CodexExecutionRequestSchema.parse(requestInput);
    const timeoutSignal = this.timeoutSignal(request.policy.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const client = this.createClient({ env: buildCodexEnvironment(this.environment) });
    const thread = client.resumeThread(request.codexThreadId, sdkThreadOptions(request));
    let sequence = 0;
    let finalOutput: string | undefined;
    let started = false;
    let terminal = false;
    let failureEmitted = false;
    const publish = async (event: CodexExecutionEventDraft) => {
      const normalized = CodexExecutionEventSchema.parse({
        ...event,
        schemaVersion: 1,
        sequence: ++sequence,
        occurredAt: this.now(),
      });
      try {
        await emit(normalized);
      } catch {
        throw new CodexExecutionError("DISPATCH_UNAVAILABLE");
      }
    };
    const fail = async (code: CodexExecutionFailureCode): Promise<never> => {
      if (!failureEmitted) {
        failureEmitted = true;
        await publish({ schemaVersion: 1, eventType: "RUN_FAILED", failureCode: code });
      }
      throw new CodexExecutionError(code);
    };

    try {
      const streamed = await thread.runStreamed(request.prompt, { signal: combinedSignal });
      for await (const rawEvent of streamed.events) {
        const parsed = RawSdkEventSchema.safeParse(rawEvent);
        if (!parsed.success) {
          await fail("MALFORMED_EVENT");
          continue;
        }
        const event = parsed.data;
        if (event.type === "thread.started") {
          if (event.thread_id !== request.codexThreadId) await fail("MALFORMED_EVENT");
          continue;
        }
        if (event.type === "turn.started") {
          if (started) await fail("MALFORMED_EVENT");
          started = true;
          await publish({
            schemaVersion: 1,
            eventType: "RUN_STARTED",
            threadId: request.codexThreadId,
          });
          continue;
        }
        if (!started && event.type === "item.completed") continue;
        if (event.type === "item.started" || event.type === "item.updated") continue;
        if (event.type === "item.completed") {
          if (event.item.type === "agent_message") finalOutput = event.item.text;
          await publish({
            schemaVersion: 1,
            eventType: "ITEM_COMPLETED",
            itemId: event.item.id,
            itemType: itemType(event.item.type),
          });
          continue;
        }
        if (event.type === "turn.failed" || event.type === "error") {
          await fail("EXECUTION_FAILED");
          continue;
        }
        if (!started || !finalOutput) {
          await fail("MALFORMED_EVENT");
          continue;
        }
        await publish({ schemaVersion: 1, eventType: "FINAL_OUTPUT", content: finalOutput });
        await publish({
          schemaVersion: 1,
          eventType: "USAGE_RECORDED",
          usage: {
            inputTokens: event.usage.input_tokens,
            cachedInputTokens: event.usage.cached_input_tokens,
            outputTokens: event.usage.output_tokens,
          },
        });
        await publish({ schemaVersion: 1, eventType: "RUN_COMPLETED" });
        terminal = true;
      }
      if (!terminal) await fail("MALFORMED_EVENT");
    } catch (error) {
      if (error instanceof CodexExecutionError) throw error;
      if (error instanceof z.ZodError) await fail("MALFORMED_EVENT");
      if (combinedSignal.aborted) {
        await fail(signal?.aborted ? "CANCELLED" : "TIMEOUT");
      }
      await fail("SDK_UNAVAILABLE");
    }
  }
}
