import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const staticSource = join(projectRoot, ".next", "static");
const standaloneNext = join(projectRoot, ".next", "standalone", "apps", "web", ".next");

await mkdir(standaloneNext, { recursive: true });
await cp(staticSource, join(standaloneNext, "static"), { force: true, recursive: true });
