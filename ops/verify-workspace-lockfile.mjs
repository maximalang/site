import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rootManifest = readJson(join(root, "package.json"));
const lockfile = readJson(join(root, "package-lock.json"));

if (lockfile.lockfileVersion !== 3 || typeof lockfile.packages !== "object" || !lockfile.packages) {
  throw new Error("package-lock.json must be an npm lockfileVersion 3 workspace lockfile");
}

const workspacePaths = resolveWorkspacePaths(rootManifest.workspaces);
const packagePaths = ["", ...workspacePaths];
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const failures = [];

for (const packagePath of packagePaths) {
  const manifestPath = packagePath ? join(root, packagePath, "package.json") : join(root, "package.json");
  const manifest = readJson(manifestPath);
  const locked = lockfile.packages[packagePath];
  if (!locked) {
    failures.push(`${packagePath || "<root>"}: missing package-lock workspace entry`);
    continue;
  }

  for (const field of dependencyFields) {
    const expected = normalizedRecord(manifest[field]);
    const actual = normalizedRecord(locked[field]);
    const expectedJson = JSON.stringify(expected);
    const actualJson = JSON.stringify(actual);
    if (expectedJson !== actualJson) {
      failures.push(
        `${packagePath || "<root>"}: ${field} differs (manifest=${expectedJson}, lock=${actualJson})`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Workspace package-lock drift detected:\n${failures.map((item) => `- ${item}`).join("\n")}`);
}

process.stdout.write(
  `${JSON.stringify({ status: "PASS", workspaces: workspacePaths.length, packageEntriesChecked: packagePaths.length })}\n`,
);

function resolveWorkspacePaths(workspaces) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error("package.json must declare non-empty npm workspaces");
  }
  const paths = [];
  for (const pattern of workspaces) {
    if (typeof pattern !== "string" || !pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace pattern: ${String(pattern)}`);
    }
    const directory = pattern.slice(0, -2);
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        readFileSync(join(root, directory, entry.name, "package.json"));
      } catch {
        continue;
      }
      paths.push(`${directory}/${entry.name}`);
    }
  }
  return paths.sort();
}

function normalizedRecord(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dependency metadata must be an object");
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, version]) => [name, String(version)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
