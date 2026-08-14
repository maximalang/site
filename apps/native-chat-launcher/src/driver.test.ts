import { describe, expect, it, vi } from "vitest";
import { type NativeChatSubmissionPage, submitRunId } from "./driver.js";

describe("submitRunId", () => {
  it("opens the configured Chat surface and submits only run_id", async () => {
    const calls: Array<[string, unknown?]> = [];
    const composer = {
      waitFor: vi.fn(async () => undefined),
      fill: vi.fn(async (value: string) => {
        calls.push(["fill", value]);
      }),
      click: vi.fn(async () => undefined),
    };
    const send = {
      waitFor: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      click: vi.fn(async () => {
        calls.push(["click"]);
      }),
    };
    const selectors: string[] = [];
    const page: NativeChatSubmissionPage = {
      goto: vi.fn(async (url) => {
        calls.push(["goto", url]);
      }),
      locator(selector) {
        selectors.push(selector);
        return selector === "#prompt-textarea" ? composer : send;
      },
      waitForURL: vi.fn(async (predicate) => {
        expect(predicate(new URL("https://chatgpt.com/c/123"))).toBe(true);
      }),
    };

    await submitRunId(
      page,
      "https://chatgpt.com/g/ai-world-agent",
      "run_11111111-1111-1111-1111-111111111111",
    );

    expect(calls).toEqual([
      ["goto", "https://chatgpt.com/g/ai-world-agent"],
      ["fill", "run_11111111-1111-1111-1111-111111111111"],
      ["click"],
    ]);
    expect(selectors).toEqual(["#prompt-textarea", '[data-testid="send-button"]']);
  });
});
