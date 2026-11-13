import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  type DiffLine,
  type DiffLineKind,
  parseUnifiedPatch,
  toSplitRows,
} from "@/lib/git-diff";

export type DiffLayout = "unified" | "split";

// Line backgrounds measured from Conductor's diff view.
const LINE_BACKGROUND: Readonly<Record<DiffLineKind, string | undefined>> = {
  context: undefined,
  add: "#273426",
  del: "#3a2423",
};

const MARKER: Readonly<Record<DiffLineKind, string>> = {
  context: " ",
  add: "+",
  del: "-",
};

export function DiffView({
  patch,
  layout,
  wrapLines,
  isTruncated,
  isBinary,
  isLoading,
}: {
  patch: string | null;
  layout: DiffLayout;
  wrapLines: boolean;
  isTruncated: boolean;
  isBinary: boolean;
  isLoading: boolean;
}) {
  const hunks = useMemo(() => (patch === null ? [] : parseUnifiedPatch(patch)), [patch]);

  if (isBinary) return <DiffMessage text="Binary file changed." />;
  if (patch === null) {
    return <DiffMessage text={isLoading ? "Loading changes…" : "No diff available for this file."} />;
  }
  if (hunks.length === 0) return <DiffMessage text="Only whitespace or mode changes." />;

  const textClass = wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre";
  return (
    <div
      data-workspace-files-diff=""
      className="min-h-0 flex-1 overflow-auto bg-background py-2 font-mono text-[13px] leading-5"
    >
      <div className={wrapLines ? "w-full" : "min-w-max"}>
        {hunks.map((hunk, index) => (
          <div key={`${index}:${hunk.header}`}>
            <div className="px-3 py-1 text-xs text-muted-foreground">{hunk.header}</div>
            {layout === "unified"
              ? hunk.lines.map((line, row) => (
                  <UnifiedRow key={row} line={line} textClass={textClass} />
                ))
              : toSplitRows(hunk.lines).map((row, rowIndex) => (
                  <div key={rowIndex} className="grid grid-cols-2">
                    <SplitCell line={row.left} side="old" textClass={textClass} />
                    <SplitCell line={row.right} side="new" textClass={textClass} />
                  </div>
                ))}
          </div>
        ))}
        {isTruncated ? (
          <DiffMessage text="The diff is truncated; open the file view for the rest." />
        ) : null}
      </div>
    </div>
  );
}

function UnifiedRow({ line, textClass }: { line: DiffLine; textClass: string }) {
  return (
    <div className="flex" style={{ background: LINE_BACKGROUND[line.kind] }}>
      <LineNumber value={line.oldNumber} />
      <LineNumber value={line.newNumber} />
      <span className="w-4 shrink-0 text-center text-muted-foreground select-none">
        {MARKER[line.kind]}
      </span>
      <span className={cn("min-w-0 flex-1 pr-4 text-foreground", textClass)}>{line.text}</span>
    </div>
  );
}

function SplitCell({
  line,
  side,
  textClass,
}: {
  line: DiffLine | null;
  side: "old" | "new";
  textClass: string;
}) {
  return (
    <div
      className={cn("flex min-w-0", side === "new" && "border-l border-border-hairline")}
      style={{ background: line === null ? undefined : LINE_BACKGROUND[line.kind] }}
    >
      <LineNumber value={line === null ? null : side === "old" ? line.oldNumber : line.newNumber} />
      <span className={cn("min-w-0 flex-1 pr-4 pl-2 text-foreground", textClass)}>
        {line?.text ?? ""}
      </span>
    </div>
  );
}

function LineNumber({ value }: { value: number | null }) {
  return (
    <span className="w-12 shrink-0 pr-3 text-right tabular-nums text-muted-foreground select-none">
      {value ?? ""}
    </span>
  );
}

function DiffMessage({ text }: { text: string }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{text}</p>;
}
