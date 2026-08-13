import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const VERSION = "scrypt-v1";
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_PASSWORD_BYTES = 1_024;
const MIN_PASSWORD_BYTES = 12;
const MAX_MEMORY = 64 * 1_024 * 1_024;

type ParsedHash = { salt: Buffer; digest: Buffer };
const DUMMY_HASH: ParsedHash = {
  salt: Buffer.alloc(SALT_LENGTH, 0xa5),
  digest: Buffer.alloc(KEY_LENGTH, 0x5a),
};

function decodeCanonicalBase64Url(input: string, length: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    return undefined;
  }
  const decoded = Buffer.from(input, "base64url");
  return decoded.length === length && decoded.toString("base64url") === input ? decoded : undefined;
}

function parseHash(input: string | undefined): ParsedHash | undefined {
  const parts = input?.split("$");
  if (
    parts?.length !== 6 ||
    parts[0] !== VERSION ||
    parts[1] !== String(N) ||
    parts[2] !== String(R) ||
    parts[3] !== String(P) ||
    !parts[4] ||
    !parts[5]
  ) {
    return undefined;
  }
  const salt = decodeCanonicalBase64Url(parts[4], SALT_LENGTH);
  const digest = decodeCanonicalBase64Url(parts[5], KEY_LENGTH);
  return salt && digest ? { salt, digest } : undefined;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error) {
          reject(error);
        } else {
          resolve(key);
        }
      },
    );
  });
}

function passwordLength(input: string): number {
  return Buffer.byteLength(input, "utf8");
}

export async function hashOwnerPassword(
  password: string,
  salt: Buffer = randomBytes(SALT_LENGTH),
): Promise<string> {
  const length = passwordLength(password);
  if (length < MIN_PASSWORD_BYTES || length > MAX_PASSWORD_BYTES) {
    throw new Error("Owner password must contain between 12 and 1024 UTF-8 bytes");
  }
  if (salt.length !== SALT_LENGTH) {
    throw new Error("Owner password salt must contain exactly 16 bytes");
  }
  const digest = await derive(password, salt);
  return [VERSION, N, R, P, salt.toString("base64url"), digest.toString("base64url")].join("$");
}

export async function verifyOwnerPassword(
  password: string,
  configuredHash: string | undefined,
): Promise<boolean> {
  const parsed = parseHash(configuredHash);
  const length = passwordLength(password);
  const bounded = length >= MIN_PASSWORD_BYTES && length <= MAX_PASSWORD_BYTES;
  const selected = parsed ?? DUMMY_HASH;
  const candidate = await derive(bounded ? password : "invalid-password-input", selected.salt);
  return parsed !== undefined && bounded && timingSafeEqual(candidate, selected.digest);
}
