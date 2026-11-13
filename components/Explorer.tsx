import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  ancestorsOf,
  buildTree,
  visibleRows,
  type FlatEntry,
  type TreeRow,
} from "@/lib/tree";
import type { ScopeRef } from "@/lib/route";
import { FileGlyph } from "./FileGlyph";
import { SearchResults } from "./SearchResults";
import { ChangesView, type ChangesLayout } from "./ChangesView";
import { type ChangedFile, useGitChanges } from "./use-git-file";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderTreeIcon, LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";

export interface ExplorerProps {
  entries: readonly FlatEntry[];
  activePath: string | null;
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
  includeHidden: boolean;
  onToggleHidden: (next: boolean) => void;
  onOpenFile: (path: string) => void;
  /** A hit from the text search: open the file on that line. */
  onOpenMatch: (path: string, line: number) => void;
  onRefresh: () => void;
  onQuickOpen: () => void;
  /** The workspace the text search runs in; null while none is resolved. */
  scope: ScopeRef | null;
  /** Bumped by ⌘⇧F: focus the search field and select what is in it. */
  searchFocusRequest: number;
  header: React.ReactNode;
  /** The git environment behind the workspace, for the Changes tab. */
  environmentId: string | null;
  /** Ask to discard one changed file (the caller confirms first). */
  onDiscardRequest: (file: ChangedFile) => void;
  /** Open a file from the Changes tab; defaults to `onOpenFile`. */
  onOpenChange?: (path: string) => void;
  /** "Pull latest from main" in the empty Changes tab. */
  onPullBase?: (baseBranch: string) => void;
}

type PanelTab = "files" | "changes";
const PANEL_TAB_KEY = "workspace-files:panel-tab";
const CHANGES_LAYOUT_KEY = "workspace-files:changes-layout";
const HIDE_VIEWED_KEY = "workspace-files:hide-viewed";

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Only a preference.
  }
}

// Row geometry measured from Conductor's file tree: 20px per level, the
// first-level mark 18px in, 28px rows. Rows sit 8px inside the panel
// (Conductor's rounded hover), so the row's own padding is 10px.
const INDENT_PER_LEVEL_PX = 20;
const ROOT_INDENT_PX = 10;
const TREE_FONT_FAMILY = '"Conductor Geist Mono", ui-monospace, "SFMono-Regular", monospace';
const EXPANDED_STORAGE_PREFIX = "workspace-files:expanded:";

/** Rows mounted at once. Beyond this the footer says how many were held back. */
const ROW_LIMIT = 600;

export function Explorer({
  entries,
  activePath,
  isLoading,
  error,
  truncated,
  includeHidden,
  onToggleHidden,
  onOpenFile,
  onOpenMatch,
  onRefresh,
  onQuickOpen,
  scope,
  searchFocusRequest,
  header,
  environmentId,
  onDiscardRequest,
  onOpenChange,
  onPullBase,
}: ExplorerProps) {
  const [panelTab, setPanelTab] = useState<PanelTab>(() =>
    readStored(PANEL_TAB_KEY, ["files", "changes"] as const, "files"),
  );
  const [changesLayout, setChangesLayout] = useState<ChangesLayout>(() =>
    readStored(CHANGES_LAYOUT_KEY, ["list", "tree"] as const, "list"),
  );
  const [hideViewed, setHideViewed] = useState(() =>
    readStored(HIDE_VIEWED_KEY, ["true", "false"] as const, "false") === "true",
  );
  const changes = useGitChanges(environmentId);
  const selectTab = (next: PanelTab) => {
    setPanelTab(next);
    store(PANEL_TAB_KEY, next);
  };
  // The field searches file CONTENTS across the workspace. Finding a file by
  // its name is the magnifier button (⌘P) beside it.
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [submitNonce, setSubmitNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const restoringExpandedRef = useRef(false);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const isSearching = query !== "" && scope !== null;
  // Conductor keeps search behind a toolbar button; the field shows while open
  // or while it holds a query.
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const showSearch = isSearchOpen || query !== "";

  useEffect(() => {
    if (searchFocusRequest === 0) return;
    setPanelTab("files");
    setIsSearchOpen(true);
    // The field mounts with the state change; focus it on the next frame.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [searchFocusRequest]);

  const tree = useMemo(() => buildTree(entries), [entries]);
  const rootPath =
    tree.length === 1 && tree[0]?.kind === "directory" ? tree[0].path : null;
  const expandedStorageKey =
    scope === null ? null : `${EXPANDED_STORAGE_PREFIX}${scope.kind}:${scope.id}`;

  useEffect(() => {
    restoringExpandedRef.current = true;
    if (expandedStorageKey === null) {
      setExpanded(rootPath === null ? new Set() : new Set([rootPath]));
      return;
    }
    const restored = readExpanded(expandedStorageKey);
    if (rootPath !== null) restored.add(rootPath);
    setExpanded(restored);
  }, [expandedStorageKey, rootPath]);

  useEffect(() => {
    if (expandedStorageKey === null) return;
    if (restoringExpandedRef.current) {
      restoringExpandedRef.current = false;
      return;
    }
    storeExpanded(expandedStorageKey, expanded);
  }, [expanded, expandedStorageKey]);

  // Reveal the active file by opening every directory above it.
  useEffect(() => {
    if (activePath === null) return;
    setExpanded((current) => {
      const ancestors = ancestorsOf(activePath);
      if (ancestors.every((ancestor) => current.has(ancestor))) return current;
      const next = new Set(current);
      for (const ancestor of ancestors) next.add(ancestor);
      return next;
    });
  }, [activePath]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activePath, entries.length]);

  const allRows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  // Expanding a huge directory (or several) can mean tens of thousands of rows.
  // Cap what is mounted rather than building them all synchronously.
  const rows = useMemo(() => {
    if (allRows.length <= ROW_LIMIT) return allRows;
    const capped = allRows.slice(0, ROW_LIMIT);
    // A blind head slice can cut the row for the file that is actually open,
    // leaving the tree with no selection and the scroll-into-view a no-op.
    // Keep it, at the cost of one row from the head.
    const activeIndex = allRows.findIndex((row) => row.node.path === activePath);
    if (activeIndex >= ROW_LIMIT) capped[ROW_LIMIT - 1] = allRows[activeIndex]!;
    return capped;
  }, [activePath, allRows]);

  const toggle = (path: string) => {
    if (path === rootPath) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const fileCount = useMemo(
    () => entries.reduce((total, entry) => total + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
      {header}

      <div
        data-workspace-files-explorer-header=""
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border-hairline px-2"
      >
        <PanelTabButton label="All files" isSelected={panelTab === "files"} onClick={() => selectTab("files")} />
        {/* Always there, like Conductor, even without git or changes. */}
        <PanelTabButton
          label="Changes"
          count={changes.files.length}
          isSelected={panelTab === "changes"}
          onClick={() => selectTab("changes")}
        />
        {panelTab === "changes" ? (
          <div className="ml-auto flex items-center gap-0.5">
            <ExplorerAction
              icon={hideViewed ? "EyeOff" : "Eye"}
              label={hideViewed ? "Show viewed files" : "Hide viewed files"}
              isActive={hideViewed}
              onClick={() => {
                setHideViewed(!hideViewed);
                store(HIDE_VIEWED_KEY, String(!hideViewed));
              }}
            />
            <button
              type="button"
              onClick={() => {
                const next = changesLayout === "list" ? "tree" : "list";
                setChangesLayout(next);
                store(CHANGES_LAYOUT_KEY, next);
              }}
              aria-label={changesLayout === "list" ? "Show changes as a tree" : "Show changes as a list"}
              title={changesLayout === "list" ? "Show as tree" : "Show as list"}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <HugeiconsIcon
                icon={changesLayout === "list" ? FolderTreeIcon : LeftToRightListBulletIcon}
                aria-hidden
                className="size-3.5"
              />
            </button>
          </div>
        ) : (
        <div className="ml-auto flex items-center gap-0.5">
          <ExplorerAction
            icon="Search"
            label="Search in files (⌘⇧F)"
            isActive={showSearch}
            onClick={() => {
              if (showSearch) {
                setIsSearchOpen(false);
                setQuery("");
              } else {
                setIsSearchOpen(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }
            }}
          />
          <ExplorerAction icon="FileText" label="Go to file by name (⌘P)" onClick={onQuickOpen} />
          <ExplorerAction
            icon={includeHidden ? "Eye" : "EyeOff"}
            label={includeHidden ? "Hide dotfiles" : "Show dotfiles"}
            isActive={includeHidden}
            onClick={() => onToggleHidden(!includeHidden)}
          />
          <ExplorerAction
            icon="ArrowReloadHorizontal"
            label="Refresh files"
            isSpinning={isLoading}
            onClick={onRefresh}
          />
        </div>
        )}
      </div>

      {panelTab === "changes" ? (
        <ChangesView
          changes={changes}
          layout={changesLayout}
          hideViewed={hideViewed}
          activePath={activePath}
          onOpenFile={onOpenChange ?? onOpenFile}
          onDiscard={onDiscardRequest}
          onPullBase={onPullBase}
        />
      ) : (
      <>

      {showSearch ? (
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="Search"
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (query !== "") setQuery("");
                else setIsSearchOpen(false);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                setSubmitNonce((current) => current + 1);
                return;
              }
              // VS Code's own bindings for the three toggles.
              if (event.altKey && !event.metaKey && !event.ctrlKey) {
                const key = event.code;
                if (key === "KeyC") setMatchCase((value) => !value);
                else if (key === "KeyW") setWholeWord((value) => !value);
                else if (key === "KeyR") setRegex((value) => !value);
                else return;
                event.preventDefault();
              }
            }}
            placeholder="Search in files"
            aria-label="Search in files"
            title="Search the text of every file (⌘⇧F)"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(
              "h-7 w-full min-w-0 rounded-md border border-border bg-background pr-[4.5rem] pl-7 text-sm",
              "text-foreground placeholder:text-muted-foreground",
              "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-px">
            <SearchToggle
              label="Match case (⌥C). Off: smart case — exact only when the query has a capital"
              glyph="Aa"
              isOn={matchCase}
              onToggle={() => setMatchCase((value) => !value)}
            />
            <SearchToggle
              label="Match whole word (⌥W)"
              glyph="ab"
              underline
              isOn={wholeWord}
              onToggle={() => setWholeWord((value) => !value)}
            />
            <SearchToggle
              label="Use regular expression (⌥R)"
              glyph=".*"
              isOn={regex}
              onToggle={() => setRegex((value) => !value)}
            />
          </div>
        </div>
      </div>
      ) : null}

      {isSearching ? (
        <SearchResults
          scope={scope}
          query={query}
          matchCase={matchCase}
          wholeWord={wholeWord}
          regex={regex}
          includeHidden={includeHidden}
          submitNonce={submitNonce}
          activePath={activePath}
          onOpenMatch={onOpenMatch}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-2">
          {error !== null ? (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          ) : isLoading && entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Reading the workspace…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              This workspace has no files yet.
            </p>
          ) : (
            <ul role="tree" aria-label="Workspace files" className="min-w-max">
              {rows.map((row) => (
                <ExplorerRow
                  key={row.node.path}
                  row={row}
                  query=""
                  isActive={row.node.path === activePath}
                  activeRef={row.node.path === activePath ? activeRowRef : undefined}
                  onToggle={toggle}
                  onOpenFile={onOpenFile}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Conductor shows no file count; only say when the list is cut short. */}
      {(!isSearching && allRows.length > rows.length) || truncated ? (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {`${fileCount.toLocaleString()} files`}
          {!isSearching && allRows.length > rows.length
            ? ` · showing first ${ROW_LIMIT.toLocaleString()}`
            : ""}
          {truncated ? " · listing truncated" : ""}
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

function PanelTabButton({
  label,
  count,
  isSelected,
  onClick,
}: {
  label: string;
  count?: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
        isSelected ? "bg-[#2c2a28] text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count === undefined ? null : (
        <span
          className="text-muted-foreground tabular-nums"
          style={{ fontFamily: '"Conductor Geist Mono", ui-monospace, monospace' }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function readExpanded(key: string): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function storeExpanded(key: string, expanded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...expanded].sort()));
  } catch {
    // The tree still works when storage is unavailable; only persistence is lost.
  }
}

function ExplorerRow({
  row,
  query,
  isActive,
  activeRef,
  onToggle,
  onOpenFile,
}: {
  row: TreeRow;
  query: string;
  isActive: boolean;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const { node, depth, isExpanded } = row;
  const isDirectory = node.kind === "directory";

  return (
    <li role="none" className="px-2">
      <button
        ref={activeRef}
        type="button"
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={isDirectory ? isExpanded : undefined}
        onClick={() =>
          isDirectory ? onToggle(node.path) : onOpenFile(node.path)
        }
        style={{
          paddingLeft: ROOT_INDENT_PX + depth * INDENT_PER_LEVEL_PX,
          fontFamily: TREE_FONT_FAMILY,
        }}
        className={cn(
          "flex h-7 w-full min-w-full cursor-pointer items-center gap-2.5 rounded-md pr-3 text-left text-[12.3px]",
          "text-foreground hover:bg-[#262322]",
          "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:-outline-offset-1",
          isActive && "bg-[#2c2a28] text-foreground",
        )}
      >
        <FileGlyph path={node.path} kind={node.kind} isExpanded={isExpanded} />
        <span className="truncate">
          <HighlightedText text={node.name} query={query} />
        </span>
      </button>
    </li>
  );
}

function SearchToggle({
  label,
  glyph,
  underline,
  isOn,
  onToggle,
}: {
  label: string;
  glyph: string;
  underline?: boolean;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isOn}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-5 w-[1.35rem] cursor-pointer items-center justify-center rounded font-mono text-[10.5px] leading-none",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isOn
          ? "bg-primary/20 text-foreground ring-1 ring-primary/50"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <span className={underline === true ? "underline underline-offset-2" : undefined}>
        {glyph}
      </span>
    </button>
  );
}

function ExplorerAction({
  icon,
  label,
  onClick,
  isActive,
  isSpinning,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onClick: () => void;
  isActive?: boolean;
  isSpinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
        "text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isActive === true && "text-foreground",
      )}
    >
      <Icon
        name={icon}
        aria-hidden
        className={cn("size-3.5", isSpinning === true && "animate-spin")}
      />
    </button>
  );
}

/**
 * Marks the query's characters inside a name. The explorer filter is a
 * subsequence match, so matched characters can be scattered — but they are
 * emitted as contiguous runs rather than one element per character, which is
 * what keeps a filtered list of a large checkout cheap to mount.
 */
export function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const chunks = useMemo(() => highlightChunks(text, query), [text, query]);
  if (chunks === null) return <>{text}</>;

  return (
    <>
      {chunks.map((chunk, index) =>
        chunk.isMatch ? (
          <mark
            // eslint-disable-next-line react/no-array-index-key -- position IS the chunk's identity
            key={index}
            className="bg-transparent font-semibold text-primary"
          >
            {chunk.text}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- same
          <span key={index}>{chunk.text}</span>
        ),
      )}
    </>
  );
}

interface HighlightChunk {
  text: string;
  isMatch: boolean;
}

/** Null when the query is empty or does not match, so the caller can bail. */
export function highlightChunks(
  text: string,
  query: string,
): HighlightChunk[] | null {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return null;

  // Compare and slice by code point: indexing the raw string would put the
  // mark on the wrong character in any name containing an emoji or other
  // astral character.
  const characters = [...text];
  const lowered = characters.map((character) => character.toLowerCase());
  const matched = new Set<number>();
  let cursor = 0;

  for (const needle of trimmed) {
    if (needle === " ") continue;
    const index = lowered.indexOf(needle, cursor);
    if (index === -1) return null;
    matched.add(index);
    cursor = index + 1;
  }

  const chunks: HighlightChunk[] = [];
  for (const [index, character] of characters.entries()) {
    const isMatch = matched.has(index);
    const last = chunks.at(-1);
    if (last !== undefined && last.isMatch === isMatch) last.text += character;
    else chunks.push({ text: character, isMatch });
  }
  return chunks;
}
