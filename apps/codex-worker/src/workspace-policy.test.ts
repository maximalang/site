import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspacePolicy, WorkspacePolicyError } from "./workspace-policy.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "agent-world-codex-policy-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WorkspacePolicy", () => {
  it("accepts an exact real Git root inside an allowlisted root", async () => {
    const allowedRoot = await temporaryDirectory();
    const repository = join(allowedRoot, "repository");
    await mkdir(join(repository, ".git"), { recursive: true });

    const policy = await WorkspacePolicy.create([allowedRoot]);

    await expect(policy.resolve(repository)).resolves.toBe(repository);
  });

  it("rejects relative paths, traversal, and non-Git directories", async () => {
    const allowedRoot = await temporaryDirectory();
    const nonRepository = join(allowedRoot, "plain-directory");
    const outside = await temporaryDirectory();
    await mkdir(nonRepository);

    const policy = await WorkspacePolicy.create([allowedRoot]);

    await expect(policy.resolve("repository")).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(policy.resolve(outside)).rejects.toMatchObject({ code: "OUTSIDE_ALLOWED_ROOT" });
    await expect(policy.resolve(nonRepository)).rejects.toMatchObject({ code: "NOT_GIT_ROOT" });
  });

  it("rejects a symlink that escapes an allowlisted root", async () => {
    const allowedRoot = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const outsideRepository = join(outside, "repository");
    const linkedRepository = join(allowedRoot, "linked-repository");
    await mkdir(join(outsideRepository, ".git"), { recursive: true });
    await symlink(outsideRepository, linkedRepository, "junction");

    const policy = await WorkspacePolicy.create([allowedRoot]);

    await expect(policy.resolve(linkedRepository)).rejects.toMatchObject({
      code: "OUTSIDE_ALLOWED_ROOT",
    });
  });

  it("rejects a Git worktree marker that points outside all allowlisted roots", async () => {
    const allowedRoot = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const repository = join(allowedRoot, "worktree");
    const outsideGitDirectory = join(outside, "git-metadata");
    await mkdir(repository);
    await mkdir(outsideGitDirectory);
    await writeFile(join(repository, ".git"), `gitdir: ${outsideGitDirectory}\n`, "utf8");

    const policy = await WorkspacePolicy.create([allowedRoot]);

    await expect(policy.resolve(repository)).rejects.toMatchObject({
      code: "OUTSIDE_ALLOWED_ROOT",
    });
  });
});
