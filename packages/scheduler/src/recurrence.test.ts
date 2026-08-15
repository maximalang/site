import { describe, expect, it } from "vitest";
import { nextOccurrence } from "./recurrence.js";

describe("nextOccurrence", () => {
  it("computes a five-field cron in its IANA timezone", () => {
    expect(
      nextOccurrence({
        expression: "0 9 * * *",
        timezone: "Europe/Moscow",
        after: "2026-08-15T10:00:00.000Z",
      }),
    ).toBe("2026-08-16T06:00:00.000Z");
  });

  it("honors daylight-saving transitions and rejects seconds-level schedules", () => {
    expect(
      nextOccurrence({
        expression: "0 9 * * *",
        timezone: "Europe/London",
        after: "2026-03-28T10:00:00.000Z",
      }),
    ).toBe("2026-03-29T08:00:00.000Z");
    expect(() =>
      nextOccurrence({
        expression: "*/5 * * * * *",
        timezone: "UTC",
        after: "2026-08-15T10:00:00.000Z",
      }),
    ).toThrow(/five-field/i);
  });
});
