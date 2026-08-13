import { spawn } from "node:child_process";
import { buildCodexEnvironment } from "@agent-world/codex-adapter";

type CommandResult = { exitCode: number | null; stdout: string; stderr: string };
export type CodexStatusCommand = (
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
) => Promise<CommandResult>;

const MAX_STATUS_OUTPUT = 4_096;

export const runCodexStatusCommand: CodexStatusCommand = (executable, arguments_, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      env: buildCodexEnvironment(process.env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let oversized = false;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const capture = (target: "stdout" | "stderr", chunk: Buffer) => {
      const next = (target === "stdout" ? stdout : stderr) + chunk.toString("utf8");
      if (next.length > MAX_STATUS_OUTPUT) {
        oversized = true;
        child.kill();
        return;
      }
      if (target === "stdout") stdout = next;
      else stderr = next;
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: oversized ? null : exitCode, stdout, stderr });
    });
  });

export async function checkCodexAuthentication(
  executable: string,
  run: CodexStatusCommand = runCodexStatusCommand,
): Promise<"CHATGPT" | "UNAVAILABLE"> {
  try {
    const result = await run(executable, ["login", "status"], 5_000);
    return result.exitCode === 0 && /logged in using chatgpt/i.test(result.stdout)
      ? "CHATGPT"
      : "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
}
