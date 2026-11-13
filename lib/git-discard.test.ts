import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discardFileChanges, insideRoot } from "./git-discard";

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
