import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CodexExecutionEvent,
  type CodexExecutionRequest,
  CodexExecutionRequestSchema,
} from "@agent-world/codex-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexWorker } from "./worker.js";
import { WorkspacePolicy } from "./workspace-policy.js";

const temporaryDirectories: string[] = [];

async function repositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-world-codex-worker-"));
  temporaryDirectories.push(root);
  const repository = join(root, "repository");
  await mkdir(join(repository, ".git"), { recursive: true });
  return { policy: await WorkspacePolicy.create([root]), repository, root };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const baseRequest = (workingDirectory: string): CodexExecutionRequest =>
  CodexExecutionRequestSchema.parse({
    schemaVersion: 1,
    runId: "run_11111111-1111-1111-1111-111111111111",
    taskId: "task_22222222-2222-2222-2222-222222222222",
    agentId: "agent_33333333-3333-3333-3333-333333333333",
    bindingId: "binding_44444444-4444-4444-4444-444444444444",
    routeId: "route_55555555-5555-5555-5555-555555555555",
    accountId: "account_66666666-6666-6666-6666-666666666666",
    sessionId: "session_77777777-7777-7777-7777-777777777777",
    codexThreadId: "thread-worker-1",
    idempotencyKey: "codex:worker:1",
    prompt: "Verify the selected repository.",
    policy: {
      workingDirectory,
      sandbox: "WORKSPACE_WRITE",
      approvalPolicy: "ON_REQUEST",
      networkAccess: false,
      timeoutMs: 60_000,
    },
  });

function storeFixture(request: CodexExecutionRequest | undefined) {
  const appended: CodexExecutionEvent[] = [];
  return {
    appended,
    store: {
      recoverExpired: vi.fn(async () => ({ interrupted: 0 })),
      claim: vi.fn(async () =>
        request
          ? {
              externalRunId: "codex_execution_88888888-8888-8888-8888-888888888888",
              attempt: 1,
              leaseExpiresAt: "2026-08-13T12:01:00.000Z",
              request,
            }
          : undefined,
      ),
      appendEvent: vi.fn(async (_executionId, _workerId, event) => {
        appended.push(event);
        return { outcome: "APPLIED" as const, sequence: event.sequence };
      }),
    },
  };
}

describe("CodexWorker", () => {
  it("recovers expired work before reporting an idle queue", async () => {
    const { policy } = await repositoryFixture();
    const fixture = storeFixture(undefined);
    fixture.store.recoverExpired.mockResolvedValue({ interrupted: 2 });
    const runner = { run: vi.fn() };
    const worker = new CodexWorker({
      store: fixture.store,
      runner,
      workspacePolicy: policy,
      workerId: "worker-1",
      leaseMs: 60_000,
    });

    await expect(worker.runOnce()).resolves.toEqual({ outcome: "IDLE", interrupted: 2 });
    expect(fixture.store.recoverExpired).toHaveBeenCalledBefore(fixture.store.claim);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("runs one claimed request and persists every normalized event", async () => {
    const { policy, repository } = await repositoryFixture();
    const fixture = storeFixture(baseRequest(repository));
    const events: CodexExecutionEvent[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        eventType: "RUN_STARTED",
        occurredAt: "2026-08-13T12:00:01.000Z",
        threadId: "thread-worker-1",
      },
      {
        schemaVersion: 1,
        sequence: 2,
        eventType: "RUN_FAILED",
        occurredAt: "2026-08-13T12:00:02.000Z",
        failureCode: "CANCELLED",
      },
    ];
    const runner = {
      run: vi.fn(async (_request, emit) => {
        for (const event of events) await emit(event);
      }),
    };
    const worker = new CodexWorker({
      store: fixture.store,
      runner,
      workspacePolicy: policy,
      workerId: "worker-1",
      leaseMs: 60_000,
    });

    await expect(worker.runOnce()).resolves.toEqual({
      outcome: "PROCESSED",
      executionId: "codex_execution_88888888-8888-8888-8888-888888888888",
      interrupted: 0,
    });
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ workingDirectory: repository }),
      }),
      expect.any(Function),
      undefined,
    );
    expect(fixture.appended).toEqual(events);
  });

  it("fails a disallowed workspace before invoking the SDK", async () => {
    const { policy } = await repositoryFixture();
    const outside = await mkdtemp(join(tmpdir(), "agent-world-codex-outside-"));
    temporaryDirectories.push(outside);
    await mkdir(join(outside, ".git"));
    const fixture = storeFixture(baseRequest(outside));
    const runner = { run: vi.fn() };
    const worker = new CodexWorker({
      store: fixture.store,
      runner,
      workspacePolicy: policy,
      workerId: "worker-1",
      leaseMs: 60_000,
      now: () => "2026-08-13T12:00:01.000Z",
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ outcome: "POLICY_REJECTED" });
    expect(runner.run).not.toHaveBeenCalled();
    expect(fixture.appended).toEqual([
      {
        schemaVersion: 1,
        sequence: 1,
        eventType: "RUN_FAILED",
        occurredAt: "2026-08-13T12:00:01.000Z",
        failureCode: "POLICY_VIOLATION",
      },
    ]);
  });

  it("does not claim another job when durable event persistence fails", async () => {
    const { policy, repository } = await repositoryFixture();
    const fixture = storeFixture(baseRequest(repository));
    fixture.store.appendEvent.mockRejectedValue(new Error("database unavailable"));
    const runner = {
      run: vi.fn(async (_request, emit) => {
        await emit({
          schemaVersion: 1,
          sequence: 1,
          eventType: "RUN_STARTED",
          occurredAt: "2026-08-13T12:00:01.000Z",
          threadId: "thread-worker-1",
        });
      }),
    };
    const worker = new CodexWorker({
      store: fixture.store,
      runner,
      workspacePolicy: policy,
      workerId: "worker-1",
      leaseMs: 60_000,
    });

    await expect(worker.runOnce()).rejects.toThrow("WORKER_CYCLE_FAILED");
    expect(fixture.store.claim).toHaveBeenCalledTimes(1);
    expect(fixture.store.appendEvent).toHaveBeenCalledTimes(1);
  });
});
