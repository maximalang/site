import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const destinationArgument = process.argv[2];
if (!destinationArgument || !isAbsolute(destinationArgument)) {
  throw new Error("Provide an absolute launcher token file path");
}

const destination = resolve(destinationArgument);
const parent = dirname(destination);
const parentStat = lstatSync(parent);
if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
  throw new Error("Launcher token parent must be an existing non-symlink directory");
}
if (existsSync(destination)) {
  throw new Error("Refusing to overwrite an existing launcher token file");
}

const token = randomBytes(32).toString("base64url");
const tokenSha256 = createHash("sha256").update(token, "utf8").digest("hex");
writeFileSync(destination, `${token}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ tokenFile: destination, tokenSha256 })}\n`);
