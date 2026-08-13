import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

describe("buildSecurityHeaders", () => {
  it("keeps the production policy same-origin and excludes dev execution allowances", () => {
    const headers = new Map(
      buildSecurityHeaders("production").map(({ key, value }) => [key.toLowerCase(), value]),
    );
    const policy = headers.get("content-security-policy");

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("allows only the websocket and eval capabilities required by Next development", () => {
    const policy = buildSecurityHeaders("development").find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;

    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
