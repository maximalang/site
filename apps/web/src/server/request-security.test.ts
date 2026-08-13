import { describe, expect, it } from "vitest";
import { hasSameOriginHost } from "./request-security";

function request(origin: string | undefined, headers: Record<string, string> = {}) {
  return new Request("http://internal:3000/api/action", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), ...headers },
  });
}

describe("hasSameOriginHost", () => {
  it("matches Origin to Host or one reverse-proxy forwarded host", () => {
    expect(hasSameOriginHost(request("https://world.test", { host: "world.test" }))).toBe(true);
    expect(
      hasSameOriginHost(
        request("https://world.test:8443", {
          host: "internal:3000",
          "x-forwarded-host": "world.test:8443",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("rejects absent, cross-site, ambiguous or URL-shaped host input", () => {
    expect(hasSameOriginHost(request(undefined, { host: "world.test" }))).toBe(false);
    expect(
      hasSameOriginHost(
        request("https://world.test", { host: "world.test", "sec-fetch-site": "cross-site" }),
      ),
    ).toBe(false);
    expect(
      hasSameOriginHost(
        request("https://world.test", { host: "internal", "x-forwarded-host": "world.test,evil" }),
      ),
    ).toBe(false);
    expect(hasSameOriginHost(request("https://world.test", { host: "https://world.test" }))).toBe(
      false,
    );
  });
});
