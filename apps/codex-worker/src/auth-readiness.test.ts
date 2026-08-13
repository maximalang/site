import { describe, expect, it, vi } from "vitest";
import { checkCodexAuthentication } from "./auth-readiness.js";

describe("checkCodexAuthentication", () => {
  it("reports only an official ChatGPT login as ready", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "Logged in using ChatGPT\n",
      stderr: "",
    }));

    await expect(checkCodexAuthentication("/app/codex", run)).resolves.toBe("CHATGPT");
    expect(run).toHaveBeenCalledWith("/app/codex", ["login", "status"], 5_000);
  });

  it("returns a bounded unavailable state without reflecting command output", async () => {
    const secret = "private-auth-token";
    const run = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: secret }));

    const status = await checkCodexAuthentication("/app/codex", run);

    expect(status).toBe("UNAVAILABLE");
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("fails closed for other successful authentication methods", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "Logged in using an API key\n",
      stderr: "",
    }));

    await expect(checkCodexAuthentication("/app/codex", run)).resolves.toBe("UNAVAILABLE");
  });
});
