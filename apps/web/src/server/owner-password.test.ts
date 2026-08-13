import { describe, expect, it } from "vitest";
import { hashOwnerPassword, verifyOwnerPassword } from "./owner-password";

describe("owner password hashing", () => {
  it("round-trips one canonical fixed-parameter scrypt hash", async () => {
    const password = "correct horse battery staple";
    const hash = await hashOwnerPassword(password, Buffer.alloc(16, 7));

    expect(hash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
    await expect(verifyOwnerPassword(password, hash)).resolves.toBe(true);
    await expect(verifyOwnerPassword("incorrect horse battery staple", hash)).resolves.toBe(false);
  });

  it("fails closed for missing, malformed, non-canonical and oversized configuration", async () => {
    await expect(verifyOwnerPassword("valid-password-input", undefined)).resolves.toBe(false);
    await expect(
      verifyOwnerPassword("short", await hashOwnerPassword("valid-password-input")),
    ).resolves.toBe(false);
    await expect(verifyOwnerPassword("valid-password-input", "scrypt-v1$1$1$1$a$b")).resolves.toBe(
      false,
    );
    await expect(
      verifyOwnerPassword("x".repeat(1_025), await hashOwnerPassword("valid-password-input")),
    ).resolves.toBe(false);
  });

  it("rejects weak setup input and invalid salt size", async () => {
    await expect(hashOwnerPassword("too-short")).rejects.toThrow("between 12 and 1024");
    await expect(hashOwnerPassword("valid-password-input", Buffer.alloc(15))).rejects.toThrow(
      "exactly 16",
    );
  });
});
