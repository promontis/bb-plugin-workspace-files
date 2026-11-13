import { describe, expect, it } from "vitest";
import { parseUnifiedPatch, toSplitRows } from "./git-diff";

const PATCH = [
  "diff --git a/a.ts b/a.ts",
  "index 1..2 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -3,4 +3,5 @@ function f() {",
  " keep",
  "-old one",
  "-old two",
  "+new one",
  "+new two",
  "+new three",
  " tail",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("numbers context, deleted and added lines from the hunk header", () => {
    const [hunk] = parseUnifiedPatch(PATCH);
    expect(hunk?.header).toBe("@@ -3,4 +3,5 @@ function f() {");
    expect(hunk?.lines.map((line) => [line.kind, line.oldNumber, line.newNumber, line.text])).toEqual([
      ["context", 3, 3, "keep"],
      ["del", 4, null, "old one"],
      ["del", 5, null, "old two"],
      ["add", null, 4, "new one"],
      ["add", null, 5, "new two"],
      ["add", null, 6, "new three"],
      ["context", 6, 7, "tail"],
    ]);
  });

  it("returns no hunks for a patch without changes", () => {
    expect(parseUnifiedPatch("")).toEqual([]);
  });
});

describe("toSplitRows", () => {
  it("pairs deletions with the additions that replace them", () => {
    const [hunk] = parseUnifiedPatch(PATCH);
    const rows = toSplitRows(hunk?.lines ?? []);
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ["keep", "keep"],
      ["old one", "new one"],
      ["old two", "new two"],
      [null, "new three"],
      ["tail", "tail"],
    ]);
  });
});
