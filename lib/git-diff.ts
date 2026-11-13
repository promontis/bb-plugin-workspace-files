/**
 * Turns one file's unified git patch into rows for the diff view: one list for
 * the unified layout and paired rows for the side-by-side layout.
 */

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedPatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      oldNumber = Number(header[1]);
      newNumber = Number(header[2]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    // File headers (diff --git, index, ---, +++) come before the first hunk.
    if (current === null) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", oldNumber: null, newNumber, text: raw.slice(1) });
      newNumber += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", oldNumber, newNumber: null, text: raw.slice(1) });
      oldNumber += 1;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", oldNumber, newNumber, text: raw.slice(1) });
      oldNumber += 1;
      newNumber += 1;
    }
  }
  return hunks;
}

/** Pair each run of deletions with the additions that follow it. */
export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && lines[index]!.kind === "del") {
      deletions.push(lines[index]!);
      index += 1;
    }
    while (index < lines.length && lines[index]!.kind === "add") {
      additions.push(lines[index]!);
      index += 1;
    }
    const count = Math.max(deletions.length, additions.length);
    for (let row = 0; row < count; row += 1) {
      rows.push({ left: deletions[row] ?? null, right: additions[row] ?? null });
    }
  }
  return rows;
}
