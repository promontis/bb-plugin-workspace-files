import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** `relativePath` resolved inside `root`; anything that escapes it is refused. */
export function insideRoot(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The path is outside the workspace.");
  }
  return absolute;
}

async function git(root: string, args: string[]): Promise<void> {
  await run("git", ["-C", root, ...args], { timeout: 15_000 });
}

async function existsAtHead(root: string, gitPath: string): Promise<boolean> {
  try {
    await git(root, ["cat-file", "-e", `HEAD:${gitPath}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discard one file's uncommitted changes: restore it from HEAD (index and
 * working tree), or remove it when HEAD does not have it (a new file).
 * Returns the absolute path that changed.
 */
export async function discardFileChanges(root: string, relativePath: string): Promise<string> {
  const absolute = insideRoot(root, relativePath);
  const gitPath = path.relative(root, absolute).split(path.sep).join("/");
  if (await existsAtHead(root, gitPath)) {
    await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", gitPath]);
  } else {
    await git(root, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", gitPath]);
    await rm(absolute, { force: true });
  }
  return absolute;
}
