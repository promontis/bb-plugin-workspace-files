import { describe, expect, it } from "vitest";
import { groupByDirectory, splitPath } from "./changes";

describe("splitPath", () => {
  it("separates the directory from the file name", () => {
    expect(splitPath("src/viewer/light.ts")).toEqual({ directory: "src/viewer", name: "light.ts" });
    expect(splitPath("README.md")).toEqual({ directory: "", name: "README.md" });
  });
});

describe("groupByDirectory", () => {
  it("groups files per directory, root first, both sorted", () => {
    const groups = groupByDirectory([
      { path: "src/viewer/worker.ts" },
      { path: "docs/viewer-design.md" },
      { path: "package.json" },
      { path: "src/viewer/light.ts" },
    ]);
    expect(groups.map((group) => [group.directory, group.files.map((file) => file.path)])).toEqual([
      ["", ["package.json"]],
      ["docs", ["docs/viewer-design.md"]],
      ["src/viewer", ["src/viewer/light.ts", "src/viewer/worker.ts"]],
    ]);
  });
});
