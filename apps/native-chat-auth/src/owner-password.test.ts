import { describe, expect, it } from "vitest";
import { hashOwnerPassword } from "../../web/src/server/owner-password.js";
import { verifyOwnerPassword } from "./owner-password.js";

describe("native Chat OAuth owner password", () => {
  it("uses the exact same canonical scrypt hash as the AI World owner session", async () => {
    const hash = await hashOwnerPassword("correct horse battery staple", Buffer.alloc(16, 7));
    await expect(verifyOwnerPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyOwnerPassword("incorrect horse battery staple", hash)).resolves.toBe(false);
  });

  it("fails closed for missing, malformed, short, and oversized inputs", async () => {
    await expect(verifyOwnerPassword("valid-password-input", undefined)).resolves.toBe(false);
    await expect(verifyOwnerPassword("valid-password-input", "scrypt-v1$1$1$1$a$b")).resolves.toBe(
      false,
    );
    await expect(verifyOwnerPassword("short", undefined)).resolves.toBe(false);
    await expect(verifyOwnerPassword("x".repeat(1_025), undefined)).resolves.toBe(false);
  });
});
