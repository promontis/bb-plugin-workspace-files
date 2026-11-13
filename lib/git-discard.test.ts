import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discardFileChanges, fastForwardToBase, insideRoot } from "./git-discard";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" }).toString();

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "files-discard-"));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(path.join(root, "kept.txt"), "original\n");
  git("add", "kept.txt");
  git("commit", "-q", "-m", "init");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("discardFileChanges", () => {
  it("restores a modified, staged file from HEAD", async () => {
    writeFileSync(path.join(root, "kept.txt"), "edited\n");
    git("add", "kept.txt");
    await discardFileChanges(root, "kept.txt");
    expect(readFileSync(path.join(root, "kept.txt"), "utf8")).toBe("original\n");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("deletes an untracked file", async () => {
    writeFileSync(path.join(root, "new.txt"), "fresh\n");
    await discardFileChanges(root, "new.txt");
    expect(existsSync(path.join(root, "new.txt"))).toBe(false);
  });

  it("unstages and deletes a newly added file", async () => {
    writeFileSync(path.join(root, "added.txt"), "fresh\n");
    git("add", "added.txt");
    await discardFileChanges(root, "added.txt");
    expect(existsSync(path.join(root, "added.txt"))).toBe(false);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("refuses paths outside the workspace", () => {
    expect(() => insideRoot(root, "../escape.txt")).toThrow();
    expect(() => insideRoot(root, ".")).toThrow();
  });
});

describe("fastForwardToBase", () => {
  it("fast-forwards a branch that is only behind its base", async () => {
    const start = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    git("checkout", "-q", "-b", "base");
    writeFileSync(path.join(root, "kept.txt"), "newer\n");
    git("commit", "-q", "-am", "newer");
    git("checkout", "-q", start);
    await fastForwardToBase(root, "base");
    expect(readFileSync(path.join(root, "kept.txt"), "utf8")).toBe("newer\n");
  });

  it("refuses to move a branch with commits of its own", async () => {
    const start = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    git("checkout", "-q", "-b", "base");
    writeFileSync(path.join(root, "kept.txt"), "base\n");
    git("commit", "-q", "-am", "base");
    git("checkout", "-q", start);
    writeFileSync(path.join(root, "own.txt"), "mine\n");
    git("add", "own.txt");
    git("commit", "-q", "-m", "own");
    await expect(fastForwardToBase(root, "base")).rejects.toThrow(/own commits/);
    expect(readFileSync(path.join(root, "kept.txt"), "utf8")).toBe("original\n");
  });

  it("rejects something that is not a branch name", async () => {
    await expect(fastForwardToBase(root, "--upload-pack=x")).rejects.toThrow();
  });
});
