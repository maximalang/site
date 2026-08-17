import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { lstat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const JWKS_FILE = "oauth-jwks.json";
const COOKIE_KEYS_FILE = "oauth-cookie-keys.json";

async function requireDedicatedDirectory(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("An explicit absolute directory path is required");
  }
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Secret target must be an existing non-symlink directory");
  }
  return resolve(directory);
}

async function requireAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${path} already exists; refusing to overwrite it`);
}

function createJwks() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    keys: [
      {
        ...privateKey.export({ format: "jwk" }),
        alg: "ES256",
        use: "sig",
        kid: `agent-world-native-chat-${randomUUID()}`,
      },
    ],
  };
}

function createCookieKeys() {
  return [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
}

export async function bootstrapNativeChatSecrets(directory) {
  const target = await requireDedicatedDirectory(directory);
  const jwksPath = join(target, JWKS_FILE);
  const cookieKeysPath = join(target, COOKIE_KEYS_FILE);
  await requireAbsent(jwksPath);
  await requireAbsent(cookieKeysPath);

  const created = [];
  try {
    await writeFile(jwksPath, `${JSON.stringify(createJwks())}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    created.push(jwksPath);
    await writeFile(cookieKeysPath, `${JSON.stringify(createCookieKeys())}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    created.push(cookieKeysPath);
    return { jwksPath, cookieKeysPath };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}
