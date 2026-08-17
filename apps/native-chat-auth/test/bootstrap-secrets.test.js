import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapNativeChatSecrets } from "../src/bootstrap-secrets.js";
import { loadConfig } from "../src/config.js";

test("creates isolated AI World OAuth secrets without returning secret material", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-world-native-chat-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = await bootstrapNativeChatSecrets(directory);

  assert.deepEqual(Object.keys(result).sort(), ["cookieKeysPath", "jwksPath"]);
  const jwks = JSON.parse(await readFile(result.jwksPath, "utf8"));
  const cookieKeys = JSON.parse(await readFile(result.cookieKeysPath, "utf8"));

  assert.equal(jwks.keys.length, 1);
  assert.match(jwks.keys[0].kid, /^agent-world-native-chat-/);
  assert.equal(jwks.keys[0].kty, "EC");
  assert.equal(jwks.keys[0].crv, "P-256");
  assert.equal(jwks.keys[0].alg, "ES256");
  assert.equal(jwks.keys[0].use, "sig");
  assert.equal(typeof jwks.keys[0].d, "string");
  assert.equal(cookieKeys.length, 2);
  assert.notEqual(cookieKeys[0], cookieKeys[1]);
  assert.ok(cookieKeys.every((value) => /^[A-Za-z0-9_-]{43}$/.test(value)));

  const config = await loadConfig({
    AGENT_WORLD_MCP_OAUTH_ISSUER: "https://agent-world.example.com/oauth",
    AGENT_WORLD_MCP_RESOURCE: "https://agent-world.example.com/api/mcp",
    AGENT_WORLD_OWNER_PASSWORD_HASH: "scrypt-v1$32768$8$1$test-fixture",
    AGENT_WORLD_MCP_OAUTH_JWKS_FILE: result.jwksPath,
    AGENT_WORLD_MCP_OAUTH_COOKIE_KEYS_FILE: result.cookieKeysPath,
  });
  assert.equal(config.jwks.keys[0].kid, jwks.keys[0].kid);

  if (process.platform !== "win32") {
    assert.equal((await stat(result.jwksPath)).mode & 0o777, 0o600);
    assert.equal((await stat(result.cookieKeysPath)).mode & 0o777, 0o600);
  }
});

test("refuses relative directories", async () => {
  await assert.rejects(
    bootstrapNativeChatSecrets("ops/secrets"),
    /absolute directory path is required/,
  );
});

test("preserves existing files and creates nothing on refusal", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-world-native-chat-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const existingPath = join(directory, "oauth-jwks.json");
  await writeFile(existingPath, "owner-data", "utf8");

  await assert.rejects(bootstrapNativeChatSecrets(directory), /already exists/);
  assert.equal(await readFile(existingPath, "utf8"), "owner-data");
  await assert.rejects(readFile(join(directory, "oauth-cookie-keys.json"), "utf8"), {
    code: "ENOENT",
  });
});
