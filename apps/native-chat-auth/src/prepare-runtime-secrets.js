import { constants } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";

const SOURCE_DIRECTORY = "/source-secrets";
const TARGET_DIRECTORY = "/runtime-secrets";
const RUNTIME_UID = 1000;
const RUNTIME_GID = 1000;
const FILES = ["oauth-jwks.json", "oauth-cookie-keys.json"];

async function requireRegularFile(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${path} must be a regular non-symlink file`);
  }
}

async function requireDirectory(path) {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${path} must be a regular non-symlink directory`);
  }
}

async function validateJson(path) {
  const contents = await readFile(path, "utf8");
  JSON.parse(contents);
  if (Buffer.byteLength(contents, "utf8") > 256 * 1024) {
    throw new Error(`${path} exceeds the native chat secret size limit`);
  }
  return contents;
}

async function replaceSecret(name) {
  const source = join(SOURCE_DIRECTORY, name);
  const target = join(TARGET_DIRECTORY, name);
  await requireRegularFile(source);
  const contents = await validateJson(source);
  const temporary = join(TARGET_DIRECTORY, `.${basename(name)}.${process.pid}.tmp`);
  await rm(temporary, { force: true });

  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await chown(temporary, RUNTIME_UID, RUNTIME_GID);
  await chmod(temporary, 0o400);
  await rename(temporary, target);
}

if (process.getuid?.() !== 0 || process.getgid?.() !== 0) {
  throw new Error("native chat secret preparation must start as uid/gid 0");
}

await requireDirectory(SOURCE_DIRECTORY);
await mkdir(TARGET_DIRECTORY, { recursive: true, mode: 0o700 });
await requireDirectory(TARGET_DIRECTORY);

for (const name of FILES) {
  await replaceSecret(name);
}

for (const name of FILES) {
  const target = join(TARGET_DIRECTORY, name);
  const details = await lstat(target);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    details.uid !== RUNTIME_UID ||
    details.gid !== RUNTIME_GID ||
    (details.mode & 0o777) !== 0o400
  ) {
    throw new Error(`${target} did not receive the required runtime ownership and mode`);
  }
}

process.stdout.write("Native Chat runtime secrets staged for uid/gid 1000 with mode 0400.\n");
