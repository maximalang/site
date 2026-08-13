import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type WorkspacePolicyErrorCode =
  | "INVALID_ALLOWED_ROOT"
  | "INVALID_WORKSPACE_PATH"
  | "OUTSIDE_ALLOWED_ROOT"
  | "NOT_GIT_ROOT";

export class WorkspacePolicyError extends Error {
  constructor(readonly code: WorkspacePolicyErrorCode) {
    super(code);
    this.name = "WorkspacePolicyError";
  }
}

function isContained(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
  );
}

async function resolveDirectory(path: string, failure: WorkspacePolicyErrorCode): Promise<string> {
  try {
    const resolved = await realpath(path);
    if (!(await stat(resolved)).isDirectory()) throw new WorkspacePolicyError(failure);
    return resolved;
  } catch (error) {
    if (error instanceof WorkspacePolicyError) throw error;
    throw new WorkspacePolicyError(failure);
  }
}

export class WorkspacePolicy {
  private constructor(private readonly allowedRoots: readonly string[]) {}

  static async create(roots: readonly string[]): Promise<WorkspacePolicy> {
    if (roots.length < 1 || roots.length > 16 || roots.some((root) => !isAbsolute(root))) {
      throw new WorkspacePolicyError("INVALID_ALLOWED_ROOT");
    }
    const resolvedRoots = await Promise.all(
      roots.map((root) => resolveDirectory(root, "INVALID_ALLOWED_ROOT")),
    );
    return new WorkspacePolicy([...new Set(resolvedRoots)]);
  }

  async resolve(requestedPath: string): Promise<string> {
    if (
      !isAbsolute(requestedPath) ||
      requestedPath.length > 4_096 ||
      [...requestedPath].some((character) => {
        const point = character.codePointAt(0);
        return point === undefined || point <= 31 || point === 127;
      })
    ) {
      throw new WorkspacePolicyError("INVALID_WORKSPACE_PATH");
    }
    const workspace = await resolveDirectory(requestedPath, "INVALID_WORKSPACE_PATH");
    if (!this.allowedRoots.some((root) => isContained(root, workspace))) {
      throw new WorkspacePolicyError("OUTSIDE_ALLOWED_ROOT");
    }
    try {
      const gitMarker = await lstat(`${workspace}${sep}.git`);
      if (gitMarker.isDirectory()) return workspace;
      if (!gitMarker.isFile() || gitMarker.size < 1 || gitMarker.size > 4_096) {
        throw new WorkspacePolicyError("NOT_GIT_ROOT");
      }
      const marker = await readFile(`${workspace}${sep}.git`, "utf8");
      const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(marker);
      if (!match?.[1]) throw new WorkspacePolicyError("NOT_GIT_ROOT");
      const gitDirectory = await resolveDirectory(
        isAbsolute(match[1]) ? match[1] : resolve(workspace, match[1]),
        "NOT_GIT_ROOT",
      );
      if (!this.allowedRoots.some((root) => isContained(root, gitDirectory))) {
        throw new WorkspacePolicyError("OUTSIDE_ALLOWED_ROOT");
      }
    } catch (error) {
      if (error instanceof WorkspacePolicyError) throw error;
      throw new WorkspacePolicyError("NOT_GIT_ROOT");
    }
    return workspace;
  }
}
