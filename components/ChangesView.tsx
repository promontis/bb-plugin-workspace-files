import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  FolderOpenIcon,
  GitPullRequestArrowIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { groupByDirectory, splitPath } from "@/lib/changes";
import type { ChangedFile, GitChangesState } from "./use-git-file";

export type ChangesLayout = "list" | "tree";

// Measured from Conductor's Changes tab.
const MUTED = "#a4a09d";
const ADDED = "#77db89";
const REMOVED = "#e77a76";
const MODIFIED_MARK = "#fceb8f";
const HOVER = "#272423";
const ACTIVE = "#2c2a28";
const GUIDE = "#373431";
const SEPARATOR = "#282523";
const MONO = '"Conductor Geist Mono", ui-monospace, "SFMono-Regular", monospace';

export function ChangesView({
  changes,
  layout,
  hideViewed,
  activePath,
  onOpenFile,
  onDiscard,
  onPullBase,
}: {
  changes: GitChangesState;
  layout: ChangesLayout;
  /** The Viewed filter (ours; Conductor has none): leave viewed files out. */
  hideViewed: boolean;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onDiscard: (file: ChangedFile) => void;
  /** Fast-forward to the base branch; omit where that is not offered. */
  onPullBase?: (baseBranch: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const count = changes.files.length;
  if (!changes.isAvailable || count === 0) {
    const base = changes.baseBranch;
    return (
      <EmptyChanges
        subtitle={
          changes.isLoading
            ? "Reading changes…"
            : changes.isAvailable
              ? "Changes appear here."
              : "This workspace is not a git checkout."
        }
        pull={
          changes.isAvailable && base !== null && changes.behindCount > 0 && onPullBase !== undefined
            ? {
                label: `Pull latest from ${base.replace(/^[^/]+\//, "")} (${changes.behindCount} ${changes.behindCount === 1 ? "commit" : "commits"})`,
                onClick: () => onPullBase(base),
              }
            : null
        }
      />
    );
  }

  const viewedCount = changes.files.reduce((total, file) => total + (file.isViewed ? 1 : 0), 0);
  const shown = hideViewed ? changes.files.filter((file) => !file.isViewed) : changes.files;
  const row = (file: ChangedFile, label: React.ReactNode) => (
    <ChangeRow
      key={file.path}
      file={file}
      label={label}
      isActive={file.path === activePath}
      onOpen={() => onOpenFile(file.path)}
      onDiscard={() => onDiscard(file)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex h-10 shrink-0 items-center px-4 text-sm"
        style={{ borderBottom: `1px solid ${SEPARATOR}`, color: MUTED }}
      >
        <span>
          {count} {count === 1 ? "file" : "files"} changed
          {viewedCount > 0 ? (
            <span className="text-xs">
              {" · "}
              {viewedCount} viewed{hideViewed ? " (hidden)" : ""}
            </span>
          ) : null}
        </span>
        <span className="ml-auto text-xs" style={{ fontFamily: MONO }}>
          <Stat additions={changes.insertions} deletions={changes.deletions} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {shown.length === 0 ? (
          <p className="px-2 py-2 text-sm" style={{ color: MUTED }}>
            {count === 0 ? "No changes." : "Every changed file is viewed."}
          </p>
        ) : layout === "list" ? (
          shown.map((file) => {
            const { directory, name } = splitPath(file.path);
            return row(
              file,
              <>
                {directory === "" ? null : <span style={{ color: MUTED }}>{directory}/</span>}
                <span>{name}</span>
              </>,
            );
          })
        ) : (
          groupByDirectory(shown).map((group) => {
            const isCollapsed = collapsed.has(group.directory);
            const files = group.files.map((file) => row(file, splitPath(file.path).name));
            if (group.directory === "") return <div key="(root)">{files}</div>;
            return (
              <div key={group.directory}>
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(group.directory)) next.delete(group.directory);
                      else next.add(group.directory);
                      return next;
                    })
                  }
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1 text-left"
                  style={{ color: MUTED }}
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    aria-hidden
                    className={cn("size-3.5 shrink-0 transition-transform", isCollapsed && "-rotate-90")}
                  />
                  <HugeiconsIcon icon={FolderOpenIcon} aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate text-xs" style={{ fontFamily: MONO }}>
                    {group.directory.split("/").join(" / ")}
                  </span>
                </button>
                {isCollapsed ? null : (
                  <div className="ml-2.5 pl-2" style={{ borderLeft: `1px solid ${GUIDE}` }}>
                    {files}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Conductor's empty Changes tab. */
function EmptyChanges({
  subtitle,
  pull,
}: {
  subtitle: string;
  pull: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 pb-10 text-center">
      <HugeiconsIcon
        icon={GitPullRequestArrowIcon}
        aria-hidden
        strokeWidth={1}
        className="mb-2 size-9"
        style={{ color: MUTED }}
      />
      <p className="text-[15px] font-medium" style={{ color: MUTED }}>
        No file changes yet
      </p>
      <p className="text-[13px]" style={{ color: "#6d6a67" }}>
        {subtitle}
      </p>
      {pull === null ? null : (
        <button
          type="button"
          onClick={pull.onClick}
          className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-state-hover hover:text-foreground"
          style={{ color: MUTED }}
        >
          <HugeiconsIcon icon={ArrowDown02Icon} aria-hidden className="size-3.5" />
          {pull.label}
        </button>
      )}
    </div>
  );
}

function ChangeRow({
  file,
  label,
  isActive,
  onOpen,
  onDiscard,
}: {
  file: ChangedFile;
  label: React.ReactNode;
  isActive: boolean;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative flex h-8 items-center gap-2 rounded-md px-2"
      style={{ background: isActive ? ACTIVE : isHovered ? HOVER : undefined }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 cursor-pointer rounded-md"
        aria-label={`Open ${file.path}`}
      />
      {/* Conductor fades a viewed file to half strength, row background aside. */}
      <span
        className="pointer-events-none min-w-0 flex-1 truncate text-sm text-foreground"
        style={file.isViewed ? { opacity: 0.5 } : undefined}
      >
        {label}
      </span>
      {isHovered ? (
        file.isUncommitted ? (
          <button
            type="button"
            onClick={onDiscard}
            aria-label={`Discard changes in ${file.path}`}
            title="Discard changes"
            className="relative z-10 flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-hover"
            style={{ color: MUTED }}
          >
            <HugeiconsIcon icon={Undo02Icon} aria-hidden className="size-3.5" />
          </button>
        ) : null
      ) : (
        <span
          className="pointer-events-none flex shrink-0 items-center gap-1.5 text-xs"
          style={{ fontFamily: MONO, opacity: file.isViewed ? 0.5 : undefined }}
        >
          {file.isUncommitted ? <span style={{ color: "#f3f2f1" }}>U</span> : null}
          <Stat additions={file.additions} deletions={file.deletions} />
          <KindMark kind={file.changeKind} isUntracked={file.isUntracked} />
        </span>
      )}
    </div>
  );
}

function Stat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="tabular-nums">
      {additions > 0 ? <span style={{ color: ADDED }}>+{additions}</span> : null}
      {additions > 0 && deletions > 0 ? " " : null}
      {deletions > 0 ? <span style={{ color: REMOVED }}>-{deletions}</span> : null}
    </span>
  );
}

/** Conductor's square status mark: a dot for modified, a plus for new, a minus for deleted. */
function KindMark({ kind, isUntracked }: { kind: string; isUntracked: boolean }) {
  const isNew = isUntracked || kind === "added";
  const isDeleted = kind === "deleted";
  const color = isNew ? MUTED : isDeleted ? REMOVED : MODIFIED_MARK;
  return (
    <svg viewBox="0 0 12 12" aria-label={isNew ? "added" : isDeleted ? "deleted" : "modified"} className="size-3 shrink-0">
      <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" fill="none" stroke={color} strokeWidth="1.2" />
      {isNew ? (
        <path d="M6 3.5v5M3.5 6h5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      ) : isDeleted ? (
        <path d="M3.5 6h5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      ) : (
        <circle cx="6" cy="6" r="1.3" fill={color} />
      )}
    </svg>
  );
}
