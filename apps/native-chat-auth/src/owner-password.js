import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const VERSION = "scrypt-v1";
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1_024 * 1_024;
const DUMMY = { salt: Buffer.alloc(SALT_LENGTH, 0xa5), digest: Buffer.alloc(KEY_LENGTH, 0x5a) };

function canonicalBase64Url(input, length) {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return undefined;
  const decoded = Buffer.from(input, "base64url");
  return decoded.length === length && decoded.toString("base64url") === input ? decoded : undefined;
}

function parseHash(input) {
  const parts = input?.split("$");
  if (
    parts?.length !== 6 ||
    parts[0] !== VERSION ||
    parts[1] !== String(N) ||
    parts[2] !== String(R) ||
    parts[3] !== String(P)
  )
    return undefined;
  const salt = canonicalBase64Url(parts[4] ?? "", SALT_LENGTH);
  const digest = canonicalBase64Url(parts[5] ?? "", KEY_LENGTH);
  return salt && digest ? { salt, digest } : undefined;
}

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function verifyOwnerPassword(password, configuredHash) {
  const parsed = parseHash(configuredHash);
  const length = Buffer.byteLength(password, "utf8");
  const bounded = length >= 12 && length <= 1_024;
  const selected = parsed ?? DUMMY;
  const candidate = await derive(bounded ? password : "invalid-password-input", selected.salt);
  return parsed !== undefined && bounded && timingSafeEqual(candidate, selected.digest);
}
