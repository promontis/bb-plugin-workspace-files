import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_copyToClipboard,
  experimental_Diff as HostDiff,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { MoreVerticalIcon, Undo02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { basename, type FlatEntry } from "@/lib/tree";
import type { ScopeRef } from "@/lib/route";
import { sameScope } from "@/lib/route";
import { isMarkdownPath } from "@/lib/markdown";
import type { ResolvedScope, rpcContract } from "../server.js";
import { Explorer } from "./Explorer";
import { EditorTabs } from "./EditorTabs";
import { FileView } from "./FileView";
import { DiffView } from "./DiffView";
import { useMonaco } from "./monaco/use-monaco";
import { useGitFile } from "./use-git-file";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { FileGlyph } from "./FileGlyph";
import { QuickOpen } from "./QuickOpen";
import { WorkspacePicker } from "./WorkspacePicker";
import {
  canPreview,
  isDirty,
  useFileTabs,
  type FileTab,
  type FileViewMode,
} from "./use-file-tabs";

interface TreeState {
  status: "idle" | "loading" | "ready" | "error";
  scope: ResolvedScope | null;
  entries: FlatEntry[];
  truncated: boolean;
  excluded: string[];
  error: string | null;
}

const EMPTY_TREE: TreeState = {
  status: "idle",
  scope: null,
  entries: [],
  truncated: false,
  excluded: [],
  error: null,
};

const MIN_EXPLORER_PX = 180;
const MAX_EXPLORER_PX = 560;
const DEFAULT_EXPLORER_PX = 260;

const WIDTH_STORAGE_KEY = "files-editor:explorer-width";
const HIDDEN_STORAGE_KEY = "files-editor:include-hidden";

export interface WorkspaceProps {
  scope: ScopeRef | null;
  filePath: string | null;
  /** Called when the open file changes, so a routed surface can mirror it. */
  onOpenPath: (path: string | null) => void;
  /** A file opened from the Changes tab (Conductor shows it in All changes). */
  onOpenChange?: (path: string) => void;
  /** Omit to pin the surface to one workspace (the thread panel does). */
  onChangeScope?: (scope: ScopeRef) => void;
  /** `panel` renders only the explorer; `page` renders the full editor. */
  variant: "page" | "panel";
}

export function Workspace({
  scope,
  filePath,
  onOpenPath,
  onOpenChange,
  onChangeScope,
  variant,
}: WorkspaceProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const tabs = useFileTabs(scope);

  const [tree, setTree] = useState<TreeState>(EMPTY_TREE);
  const [includeHidden, setIncludeHidden] = useState(readStoredHidden);
  const [explorerWidth, setExplorerWidth] = useState(readStoredWidth);
  // Both surfaces open on the tree — that is what you came for. The narrow
  // panel then collapses it once you pick a file, to give the editor the width.
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  // A counter, not a flag: pressing ⌘F again with the bar already open has to
  // re-focus and reselect the field, which an unchanged boolean cannot signal.
  const [findRequest, setFindRequest] = useState(0);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  // Conductor's diff controls: per-file view, two persisted toggles, discard.
  // Files switched to the plain file view; every other changed file shows the
  // diff in the remembered layout (side by side by default, as Conductor).
  const [fileViewPaths, setFileViewPaths] = useState<ReadonlySet<string>>(new Set());
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">(() =>
    safeRead(DIFF_LAYOUT_KEY) === "unified" ? "unified" : "split",
  );
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(() => readStoredFlag(IGNORE_WHITESPACE_KEY));
  const [wrapLines, setWrapLines] = useState(() => readStoredFlag(WRAP_LINES_KEY));
  // The file the discard dialog asks about; from the toolbar or the Changes list.
  const [discardTarget, setDiscardTarget] = useState<{ path: string; isNew: boolean } | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  // ⌘⇧F focuses the explorer's text search, VS Code's binding for "search in files".
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  // A search hit to reveal: the file it is in, the line, and a nonce so opening
  // the same hit twice scrolls to it again.
  const [reveal, setReveal] = useState<{ path: string; line: number; nonce: number } | null>(
    null,
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  // A toast action outlives the render that created it; navigation has to be
  // read live rather than captured.
  const onOpenPathRef = useRef(onOpenPath);
  onOpenPathRef.current = onOpenPath;
  // Closing navigates away, but the route arrives back as a prop a render
  // later. In that gap the route still names the file that was just closed,
  // and the effect below would helpfully reopen it. This remembers the value
  // to ignore until the route catches up.
  const staleRouteFile = useRef<string | null>(null);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  /** Return the keyboard to the surface when a child that held focus is gone. */
  const restoreFocus = useCallback(() => {
    const root = rootRef.current;
    if (root === null) return;
    if (root.contains(document.activeElement)) return;
    root.focus({ preventScroll: true });
  }, []);

  const loadTree = useCallback(
    (target: ScopeRef | null, hidden: boolean) => {
      if (target === null) {
        setTree(EMPTY_TREE);
        return;
      }
      const generation = (requestRef.current += 1);
      setTree((current) => ({ ...current, status: "loading", error: null }));

      void rpc
        .call("tree", { scope: target, includeHidden: hidden })
        .then((result) => {
          if (requestRef.current !== generation) return;
          setTree({
            status: "ready",
            scope: result.scope,
            entries: result.entries,
            truncated: result.truncated,
            excluded: result.excluded,
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (requestRef.current !== generation) return;
          setTree({
            ...EMPTY_TREE,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Could not read this workspace.",
          });
        });
    },
    [rpc],
  );

  // Keyed on the scope's VALUE, not the object: callers build the ref during
  // render, so a fresh identity every render would re-walk the whole workspace
  // on every keystroke and every file click.
  const scopeKind = scope?.kind ?? null;
  const scopeId = scope?.id ?? null;
  useEffect(() => {
    loadTree(
      scopeKind === null || scopeId === null ? null : { kind: scopeKind, id: scopeId },
      includeHidden,
    );
  }, [includeHidden, loadTree, scopeId, scopeKind]);

  // Open the file named by the route: on arrival, when the route moves to
  // another file, and after a scope change cleared the tabs out from under it.
  const hasRoutedTab = tabs.tabs.some((tab) => tab.path === filePath);
  useEffect(() => {
    if (variant === "panel") return;
    if (staleRouteFile.current !== null) {
      if (filePath === staleRouteFile.current) return;
      staleRouteFile.current = null;
    }
    if (filePath === null) return;
    if (tabs.activePath === filePath || hasRoutedTab) return;
    tabs.open(filePath);
    // `tabs` is rebuilt every render; the open is keyed on the route value and
    // on whether this surface already holds that file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, hasRoutedTab, scopeId, scopeKind, variant]);

  useRealtime("files-editor/changed", (payload) => {
    const change = payload as { scope?: ScopeRef; path?: string; sha256?: string };
    if (typeof change.path !== "string") return;
    if (!sameScope(change.scope ?? null, scope)) return;
    const tab = tabs.tabs.find((candidate) => candidate.path === change.path);
    if (tab === undefined || isDirty(tab)) return;
    if (tab.sha256 === change.sha256) return;
    tabs.reload(change.path);
  });

  const openFile = useCallback(
    (path: string) => {
      if (variant === "panel") {
        onOpenPath(path);
        return;
      }
      staleRouteFile.current = null;
      setReveal(null);
      tabs.open(path);
      onOpenPath(path);
      setFindRequest(0);
      // The explorer deliberately stays open: it used to collapse itself on the
      // narrow panel to give the editor width, which meant the tree vanished
      // under you every time you opened a file. Closing it is the toggle's job.
      //
      // The element that held focus is routinely the one the open destroys —
      // the empty state's button, or the previous file's textarea. Recover it,
      // or the root's ⌘P / ⌘S handlers stop receiving keys.
      requestAnimationFrame(restoreFocus);
    },
    [onOpenPath, restoreFocus, tabs, variant],
  );

  // A ref, not derived from the previous state: openFile resets the reveal to
  // null in the same batch, so an updater would always see null and every hit
  // would get the same nonce — and clicking one twice would not scroll again.
  const revealNonce = useRef(0);
  const openMatch = useCallback(
    (path: string, line: number) => {
      if (variant === "panel") {
        onOpenPath(path);
        return;
      }
      openFile(path);
      // A markdown tab opens in Preview, which renders the document and has no
      // lines to scroll to. A search hit names a line, so show the source —
      // the same reason ⌘F flips a preview tab to Read.
      tabs.showSource(path);
      revealNonce.current += 1;
      setReveal({ path, line, nonce: revealNonce.current });
    },
    [onOpenPath, openFile, tabs, variant],
  );

  const closeTab = useCallback(
    (path: string) => {
      staleRouteFile.current = filePath;
      const tab = tabs.tabs.find((candidate) => candidate.path === path);
      if (tab !== undefined && isDirty(tab)) {
        toast.warning(`${path} has unsaved changes`, {
          action: {
            label: "Close anyway",
            // Through the ref: the action can be clicked many renders later,
            // and the captured `onOpenPath` would navigate using the route as
            // it was when the X was clicked, not as it is now.
            onClick: () => onOpenPathRef.current(tabs.close(path)),
          },
        });
        return;
      }
      onOpenPath(tabs.close(path));
    },
    [filePath, onOpenPath, tabs],
  );

  /** Shared by "close others" and "close all": both can discard several drafts. */
  const closeMany = useCallback(
    (doomed: readonly FileTab[], run: () => string | null) => {
      staleRouteFile.current = filePath;
      const dirtyCount = doomed.filter(isDirty).length;
      if (dirtyCount > 0) {
        toast.warning(
          dirtyCount === 1
            ? "1 file has unsaved changes"
            : `${dirtyCount} files have unsaved changes`,
          {
            action: {
              label: "Close anyway",
              onClick: () => onOpenPathRef.current(run()),
            },
          },
        );
        return;
      }
      onOpenPath(run());
    },
    [filePath, onOpenPath],
  );

  const closeOtherTabs = useCallback(
    (path: string) => {
      closeMany(
        tabs.tabs.filter((tab) => tab.path !== path),
        () => tabs.closeOthers(path),
      );
    },
    [closeMany, tabs],
  );

  const closeAllTabs = useCallback(() => {
    closeMany(tabs.tabs, () => {
      tabs.closeAll();
      return null;
    });
  }, [closeMany, tabs]);

  const activateTab = useCallback(
    (path: string) => {
      tabs.activate(path);
      onOpenPath(path);
    },
    [onOpenPath, tabs],
  );

  const activeTab = tabs.activeTab;
  const resolved = tree.scope;

  const { monaco } = useMonaco();
  const git = useGitFile({
    environmentId: resolved?.environmentId ?? null,
    path: activeTab?.path ?? null,
    ignoreWhitespace,
  });
  const display: FileDisplay =
    activeTab === null || !git.isChanged || fileViewPaths.has(activeTab.path) ? "file" : diffLayout;
  const setDisplay = (next: FileDisplay) => {
    if (activeTab === null) return;
    const path = activeTab.path;
    setFileViewPaths((current) => {
      const updated = new Set(current);
      if (next === "file") updated.add(path);
      else updated.delete(path);
      return updated;
    });
    if (next !== "file") {
      setDiffLayout(next);
      safeWrite(DIFF_LAYOUT_KEY, next);
    }
  };

  const discardChanges = useCallback(async () => {
    if (discardTarget === null || scope === null) return;
    const { path, isNew } = discardTarget;
    setIsDiscarding(true);
    try {
      await rpc.call("discard", { scope, path });
      setDiscardTarget(null);
      const isOpen = tabs.tabs.some((tab) => tab.path === path);
      if (isOpen && isNew) {
        tabs.close(path);
      } else if (isOpen && tabs.activeTab?.path === path) {
        tabs.reload();
      }
      loadTree(scope, includeHidden);
      toast.success(`Discarded changes in ${basename(path)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not discard the changes");
    } finally {
      setIsDiscarding(false);
    }
  }, [discardTarget, includeHidden, loadTree, rpc, scope, tabs]);

  const openInPreview = useCallback(() => {
    if (activeTab === null || resolved === null) return;
    const opened = navigate.experimental_openFilePreview({
      target:
        resolved.environmentId === null
          ? {
              kind: "host",
              hostId: resolved.hostId,
              path: absolutePathFor(resolved.root, activeTab.path),
            }
          : {
              kind: "workspace",
              environmentId: resolved.environmentId,
              path: activeTab.path,
            },
      location: null,
    });
    if (!opened) toast.error("This surface has no file preview panel.");
  }, [activeTab, navigate, resolved]);

  const copyFileContents = useCallback(() => {
    if (activeTab?.file?.kind !== "text") return;
    void experimental_copyToClipboard({
      text: activeTab.draft ?? activeTab.file.content,
    }).then((copied) => {
      if (copied) toast.success("File contents copied");
      else toast.error("Could not copy the file contents");
    });
  }, [activeTab]);

  // Find searches the file's text, and reveals a hit by highlighting its line
  // in the source viewer — the rendered pane has no lines and its text is not
  // the text being searched. So opening find on a preview tab first shows it
  // the source it is about to search.
  const openFind = () => {
    if (activeTab === null) return;
    tabs.showSource(activeTab.path);
    setFindRequest((current) => current + 1);
  };

  // Find has no bar over a rendered pane, so a tab that enters Preview — from
  // the segment, by activating it, or by closing the tab in front of it — ends
  // the find session rather than hiding it. Set during render, not in an
  // effect, so the pane never draws a bar for the frame in between.
  if (findRequest > 0 && activeTab?.mode === "preview") setFindRequest(0);
  const isFindShowing = findRequest > 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const isAccel = event.metaKey || event.ctrlKey;
    if (isAccel && event.key.toLowerCase() === "p" && !event.shiftKey) {
      event.preventDefault();
      setIsQuickOpen(true);
      return;
    }
    if (isAccel && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setIsExplorerOpen(true);
      setSearchFocusRequest((current) => current + 1);
      return;
    }
    if (isAccel && event.key.toLowerCase() === "f" && !event.shiftKey) {
      // Claims the browser's own find, which cannot see a virtualized tree or
      // the textarea's unrendered lines anyway.
      event.preventDefault();
      if (activeTab?.file?.kind === "text") openFind();
      return;
    }
    if (isAccel && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (
        activeTab !== null &&
        isDirty(activeTab) &&
        activeTab.save.kind !== "saving"
      ) {
        tabs.save();
      }
      return;
    }
    if (event.key === "Escape" && isQuickOpen) {
      event.preventDefault();
      setIsQuickOpen(false);
      return;
    }
    if (event.key === "Escape" && isFindShowing) {
      event.preventDefault();
      setFindRequest(0);
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      setExplorerWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      setExplorerWidth((width) => {
        storeWidth(width);
        return width;
      });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
  };

  // Conductor's file panel names no workspace; only the page variant keeps
  // its workspace picker above the toolbar.
  const explorerHeader = useMemo(
    () =>
      onChangeScope === undefined ? null : (
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          <WorkspacePicker
            current={resolved}
            onSelect={(next) => {
              onChangeScope(next);
              setIsQuickOpen(false);
            }}
          />
        </div>
      ),
    [onChangeScope, resolved],
  );

  if (variant === "panel") {
    return (
      <div
        ref={rootRef}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background focus:outline-none"
      >
        <Explorer
          entries={tree.entries}
          activePath={filePath}
          isLoading={tree.status === "loading"}
          error={tree.error}
          truncated={tree.truncated}
          includeHidden={includeHidden}
          onToggleHidden={(next) => {
            setIncludeHidden(next);
            storeHidden(next);
          }}
          onOpenFile={openFile}
          onOpenChange={onOpenChange}
          onOpenMatch={(path) => onOpenPath(path)}
          onRefresh={() => loadTree(scope, includeHidden)}
          onQuickOpen={() => setIsQuickOpen(true)}
          scope={scope}
          searchFocusRequest={searchFocusRequest}
          header={explorerHeader}
          environmentId={resolved?.environmentId ?? null}
          onDiscardRequest={(file) =>
            setDiscardTarget({ path: file.path, isNew: file.isUntracked || file.changeKind === "added" })
          }
        />
        {isQuickOpen ? (
          <QuickOpen
            entries={tree.entries}
            onOpenFile={openFile}
            onClose={() => setIsQuickOpen(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      // Focusable and focused on mount so ⌘P and ⌘S work before anything inside
      // has been clicked, and again after a child that had focus unmounts.
      tabIndex={-1}
      // `h-full` as well as `flex-1`: flex-1 only sizes this when the host
      // hands the surface a flex column. A thread panel tab is a definite-height
      // box, where flex-1 does nothing, the root takes its content's height, and
      // nothing inside it — the tree least of all — can ever scroll.
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background focus:outline-none"
    >
      {isExplorerOpen ? (
        <>
          <div
            style={{ width: explorerWidth }}
            className="flex min-h-0 shrink-0 flex-col overflow-hidden"
          >
            <Explorer
              entries={tree.entries}
              activePath={tabs.activePath}
              isLoading={tree.status === "loading"}
              error={tree.error}
              truncated={tree.truncated}
              includeHidden={includeHidden}
              onToggleHidden={(next) => {
                setIncludeHidden(next);
                storeHidden(next);
              }}
              onOpenFile={openFile}
              onOpenMatch={openMatch}
              onRefresh={() => loadTree(scope, includeHidden)}
              onQuickOpen={() => setIsQuickOpen(true)}
              scope={scope}
              searchFocusRequest={searchFocusRequest}
              header={explorerHeader}
          environmentId={resolved?.environmentId ?? null}
          onDiscardRequest={(file) =>
            setDiscardTarget({ path: file.path, isNew: file.isUntracked || file.changeKind === "added" })
          }
            />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the file explorer"
            onPointerDown={startResize}
            onDoubleClick={() => {
              setExplorerWidth(DEFAULT_EXPLORER_PX);
              storeWidth(DEFAULT_EXPLORER_PX);
            }}
            className="w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring"
          />
        </>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tabs.tabs.length > 1 ? (
          <EditorTabs
            tabs={tabs.tabs}
            activePath={tabs.activePath}
            onActivate={activateTab}
            onClose={closeTab}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
          />
        ) : null}

        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <button
            type="button"
            onClick={() => setIsExplorerOpen((open) => !open)}
            aria-label={isExplorerOpen ? "Hide the file explorer" : "Show the file explorer"}
            title={activeTab?.path ?? (isExplorerOpen ? "Hide the file explorer" : "Show the file explorer")}
            className={cn(
              "flex h-7 min-w-0 max-w-[70%] shrink cursor-pointer items-center gap-1.5 rounded-md border border-border px-2",
              "text-xs font-medium text-foreground shadow-xs hover:bg-state-hover",
              "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            )}
          >
            {activeTab === null ? (
              <Icon name="PanelLeft" aria-hidden className="size-3.5 text-muted-foreground" />
            ) : (
              <FileGlyph path={activeTab.path} kind="file" />
            )}
            {activeTab === null ? (
              <span className="truncate">Files</span>
            ) : (
              <FilePathLabel path={activeTab.path} />
            )}
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {activeTab !== null && git.isChanged ? (
              <GlyphButton
                icon={Undo02Icon}
                label="Discard changes"
                onClick={() =>
                  setDiscardTarget({
                    path: activeTab.path,
                    isNew: git.isUntracked || git.changeKind === "added",
                  })
                }
              />
            ) : null}
            {activeTab?.file?.kind === "text" ? (
              <ToolbarButton icon="Copy" label="Copy file contents" onClick={copyFileContents} />
            ) : null}
            {activeTab !== null && git.isChanged ? (
              <DisplayToggle value={display} onChange={setDisplay} />
            ) : null}
            {activeTab?.file?.kind === "text" ? (
              <>
                {display === "file" && monaco !== null && isMarkdownPath(activeTab.path) ? (
                  <PreviewToggle
                    isPreview={activeTab.mode === "preview"}
                    canPreview={canPreview(activeTab)}
                    onChange={(preview) => tabs.setMode(activeTab.path, preview ? "preview" : "edit")}
                  />
                ) : null}
                {display === "file" && monaco === null ? (
                  <ModeToggle
                    mode={activeTab.mode}
                    isMarkdown={isMarkdownPath(activeTab.path)}
                    canPreview={canPreview(activeTab)}
                    canEdit={activeTab.file.editable}
                    onChange={(next) => tabs.setMode(activeTab.path, next)}
                  />
                ) : null}
                {/* No Save button: files autosave, like Conductor; ⌘S saves at once. */}
              </>
            ) : null}
            {activeTab !== null ? (
              <div
                className="relative"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setIsFileMenuOpen(false);
                }}
              >
                <GlyphButton
                  icon={MoreVerticalIcon}
                  label="More file actions"
                  isActive={isFileMenuOpen}
                  onClick={() => setIsFileMenuOpen((open) => !open)}
                />
                {isFileMenuOpen ? (
                  <div className="absolute top-9 right-0 z-30 w-60 rounded-lg border border-border bg-popover p-1 shadow-lg">
                    {git.isChanged ? (
                      <>
                        <FileMenuToggle
                          label="Hide whitespace changes"
                          isOn={ignoreWhitespace}
                          onToggle={() => {
                            const next = !ignoreWhitespace;
                            setIgnoreWhitespace(next);
                            storeFlag(IGNORE_WHITESPACE_KEY, next);
                          }}
                        />
                        <FileMenuToggle
                          label="Wrap lines"
                          isOn={wrapLines}
                          onToggle={() => {
                            const next = !wrapLines;
                            setWrapLines(next);
                            storeFlag(WRAP_LINES_KEY, next);
                          }}
                        />
                        <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                      </>
                    ) : null}
                    {activeTab.file?.kind === "text" ? (
                      <FileMenuButton icon="Search" label="Find in file" shortcut="⌘F" onClick={() => {
                        setIsFileMenuOpen(false);
                        openFind();
                      }} />
                    ) : null}
                      <FileMenuButton icon="RotateCcw" label="Reload from disk" onClick={() => {
                      setIsFileMenuOpen(false);
                      tabs.reload();
                    }} />
                    {resolved !== null ? (
                      <FileMenuButton icon="ExternalLink" label="Open in BB preview" onClick={() => {
                        setIsFileMenuOpen(false);
                        openInPreview();
                      }} />
                    ) : null}
                    <FileMenuButton
                      icon="PanelLeft"
                      label={isExplorerOpen ? "Hide file explorer" : "Show file explorer"}
                      onClick={() => {
                        setIsFileMenuOpen(false);
                        setIsExplorerOpen((open) => !open);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {activeTab !== null && git.isChanged ? (
              <ViewedCheckbox
                isViewed={git.isViewed}
                onChange={(next) => {
                  void git.setViewed(next).catch(() => toast.error("Could not update Viewed"));
                }}
              />
            ) : null}
          </div>
        </div>

        {activeTab === null ? (
          <EmptyEditor
            hasWorkspace={resolved !== null}
            error={tree.error}
            truncated={tree.truncated}
            excluded={tree.excluded}
            onQuickOpen={() => setIsQuickOpen(true)}
          />
        ) : display !== "file" && git.patch !== null && !git.isPatchTruncated && !git.isBinary ? (
          // Conductor's diff: BB's own diff renderer (@pierre/diffs) on the active
          // code theme — collapsed "N unmodified lines" bars that expand when both
          // full sides are supplied, hatched gaps, change bars, word highlights.
          <div key={activeTab.path} data-workspace-files-host-diff="" className="flex min-h-0 flex-1 flex-col overflow-auto">
            <HostDiff
              patch={git.patch}
              path={activeTab.path}
              view={display === "split" ? "split" : "unified"}
              overflow={wrapLines ? "wrap" : "scroll"}
              {...(git.originalContent !== null && activeTab.file?.kind === "text"
                ? {
                    experimental_fullFileContents: {
                      old: { path: activeTab.path, content: git.originalContent },
                      // The patch describes the file on disk, not an unsaved draft.
                      new: { path: activeTab.path, content: activeTab.file.content },
                    },
                  }
                : {})}
            />
          </div>
        ) : display !== "file" ? (
          <DiffView
            patch={git.patch}
            layout={display}
            wrapLines={wrapLines}
            isTruncated={git.isPatchTruncated}
            isBinary={git.isBinary}
            isLoading={git.isLoading}
          />
        ) : (
          <FileView
            monaco={monaco}
            tab={activeTab}
            onChangeDraft={tabs.setDraft}
            onSave={tabs.save}
            onReload={() => tabs.reload()}
            onOverwrite={tabs.overwrite}
            onRetry={tabs.retry}
            revealLine={
              reveal !== null && reveal.path === activeTab.path
                ? { line: reveal.line, nonce: reveal.nonce }
                : null
            }
            findRequest={findRequest}
            onCloseFind={() => {
              setFindRequest(0);
              restoreFocus();
            }}
          />
        )}
      </div>

      <Dialog
        open={discardTarget !== null}
        onOpenChange={(open) => (isDiscarding || open ? null : setDiscardTarget(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              {discardTarget === null
                ? ""
                : discardTarget.isNew
                  ? `${basename(discardTarget.path)} is a new file. Discarding deletes it. This cannot be undone.`
                  : `${basename(discardTarget.path)} goes back to its last commit. Uncommitted edits are lost. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="h-8 cursor-pointer rounded-md px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => setDiscardTarget(null)}
              disabled={isDiscarding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-8 cursor-pointer rounded-md bg-destructive px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              onClick={() => void discardChanges()}
              disabled={isDiscarding}
            >
              {isDiscarding ? "Discarding…" : "Discard changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isQuickOpen ? (
        <QuickOpen
          entries={tree.entries}
          onOpenFile={openFile}
          onClose={() => setIsQuickOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Workspace-relative path: folders muted and truncated first, file name always visible. */
function FilePathLabel({ path }: { path: string }) {
  const name = basename(path);
  const folder = path.slice(0, path.length - name.length);
  return (
    <span className="flex min-w-0 items-center">
      {folder === "" ? null : (
        <span className="min-w-0 truncate text-muted-foreground">{folder}</span>
      )}
      <span className="shrink-0">{name}</span>
    </span>
  );
}

function EmptyEditor({
  hasWorkspace,
  error,
  truncated,
  excluded,
  onQuickOpen,
}: {
  hasWorkspace: boolean;
  error: string | null;
  truncated: boolean;
  excluded: readonly string[];
  onQuickOpen: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon name="Code" aria-hidden className="size-8 text-muted-foreground/60" />
      {error !== null ? (
        <p className="max-w-sm text-sm text-destructive-text">{error}</p>
      ) : !hasWorkspace ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          Pick a workspace to browse its files.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Select a file to open it, or{" "}
            <button
              type="button"
              onClick={onQuickOpen}
              className="cursor-pointer font-medium text-foreground underline underline-offset-2"
            >
              go to file
            </button>
            .
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            {excluded.length === 0
              ? "Every file in the workspace is listed."
              : `Excluding ${excluded.join(", ")}.`}
            {truncated ? " The listing hit its size limit." : ""}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Preview / Read / Edit as labelled segments rather than one icon that swaps
 * meaning. An icon-only toggle has to be read twice — once for the glyph, once
 * to work out whether it shows the current mode or the one it switches to.
 */
function ModeToggle({
  mode,
  isMarkdown,
  canPreview,
  canEdit,
  onChange,
}: {
  mode: FileViewMode;
  /** Only markdown has a rendered form; every other file gets two segments. */
  isMarkdown: boolean;
  canPreview: boolean;
  canEdit: boolean;
  onChange: (mode: FileViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="File mode"
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-raised p-1"
    >
      {isMarkdown ? (
        <ModeSegment
          icon="FileText"
          label="Preview"
          isSelected={mode === "preview"}
          // Rendering is one synchronous pass over the whole document, so a
          // huge one would freeze the surface; the segment says why it is off.
          isDisabled={!canPreview}
          title={canPreview ? undefined : "This file is too large to preview"}
          onClick={() => onChange("preview")}
        />
      ) : null}
      <ModeSegment
        icon="Eye"
        label="Read"
        isSelected={mode === "read"}
        onClick={() => onChange("read")}
      />
      <ModeSegment
        icon="Edit"
        label="Edit"
        isSelected={mode === "edit"}
        // A file too large to edit stays readable; the segment says why.
        isDisabled={!canEdit && mode !== "edit"}
        title={canEdit ? undefined : "This file is too large to edit"}
        onClick={() => onChange("edit")}
      />
    </div>
  );
}

function ModeSegment({
  icon,
  label,
  isSelected,
  isDisabled,
  title,
  onClick,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  isSelected: boolean;
  isDisabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-pressed={isSelected}
      title={title ?? label}
      className={cn(
        "flex size-7 items-center justify-center rounded-md transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isDisabled === true
          ? "cursor-default text-muted-foreground opacity-40"
          : isSelected
            ? "cursor-pointer bg-state-active text-foreground"
            : "cursor-pointer text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon name={icon} aria-hidden className="size-3" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  isActive,
  isDisabled,
  isSpinning,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onClick: () => void;
  isActive?: boolean;
  isDisabled?: boolean;
  isSpinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isDisabled === true
          ? "cursor-default opacity-40"
          : "cursor-pointer hover:bg-state-hover hover:text-foreground",
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

type FileDisplay = "unified" | "split" | "file";

const IGNORE_WHITESPACE_KEY = "workspace-files:ignore-whitespace";
const DIFF_LAYOUT_KEY = "workspace-files:diff-layout";
const WRAP_LINES_KEY = "workspace-files:wrap-lines";

function readStoredFlag(key: string): boolean {
  return safeRead(key) === "true";
}

function storeFlag(key: string, value: boolean): void {
  safeWrite(key, value ? "true" : "false");
}

/** Markdown only: the file itself or its rendered preview, as in Conductor. */
function PreviewToggle({
  isPreview,
  canPreview,
  onChange,
}: {
  isPreview: boolean;
  canPreview: boolean;
  onChange: (preview: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Markdown display"
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-raised p-1"
    >
      <ModeSegment icon="FileText" label="File" isSelected={!isPreview} onClick={() => onChange(false)} />
      <ModeSegment
        icon="Eye"
        label="Preview"
        isSelected={isPreview}
        isDisabled={!canPreview}
        title={canPreview ? undefined : "This file is too large to preview"}
        onClick={() => onChange(true)}
      />
    </div>
  );
}

/** Conductor's three views of a changed file: unified diff, split diff, file. */
function DisplayToggle({
  value,
  onChange,
}: {
  value: FileDisplay;
  onChange: (next: FileDisplay) => void;
}) {
  return (
    <div
      role="group"
      aria-label="File display"
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-raised p-1"
    >
      <ModeSegment icon="AlignLeft" label="Unified diff" isSelected={value === "unified"} onClick={() => onChange("unified")} />
      <ModeSegment icon="Columns2" label="Split diff" isSelected={value === "split"} onClick={() => onChange("split")} />
      <ModeSegment icon="FileText" label="File" isSelected={value === "file"} onClick={() => onChange("file")} />
    </div>
  );
}

function GlyphButton({
  icon,
  label,
  onClick,
  isActive,
}: {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-state-hover hover:text-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        isActive === true && "bg-state-hover text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} aria-hidden className="size-3.5" />
    </button>
  );
}

function FileMenuToggle({
  label,
  isOn,
  onToggle,
}: {
  label: string;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={isOn}
      onClick={onToggle}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-state-hover"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {isOn ? <Icon name="Check" aria-hidden className="size-3.5 text-muted-foreground" /> : null}
    </button>
  );
}

function ViewedCheckbox({
  isViewed,
  onChange,
}: {
  isViewed: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isViewed}
      onClick={() => onChange(!isViewed)}
      className="ml-1 flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 items-center justify-center rounded-[4px] border",
          isViewed ? "border-foreground bg-foreground text-background" : "border-muted-foreground",
        )}
      >
        {isViewed ? <Icon name="Check" className="size-3" /> : null}
      </span>
      Viewed
    </button>
  );
}

function FileMenuButton({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs",
        "text-foreground hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none",
      )}
    >
      <Icon name={icon} aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut === undefined ? null : (
        <kbd className="font-sans text-[10px] text-muted-foreground">{shortcut}</kbd>
      )}
    </button>
  );
}

function absolutePathFor(root: string, relativePath: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const trimmed = root.endsWith(separator) ? root.slice(0, -1) : root;
  const tail =
    separator === "\\" ? relativePath.replace(/\//g, "\\") : relativePath;
  return `${trimmed}${separator}${tail}`;
}

function clampWidth(value: number): number {
  return Math.min(MAX_EXPLORER_PX, Math.max(MIN_EXPLORER_PX, Math.round(value)));
}

function readStoredWidth(): number {
  const stored = safeRead(WIDTH_STORAGE_KEY);
  const parsed = stored === null ? Number.NaN : Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_EXPLORER_PX;
}

function storeWidth(value: number): void {
  safeWrite(WIDTH_STORAGE_KEY, String(value));
}

function readStoredHidden(): boolean {
  return safeRead(HIDDEN_STORAGE_KEY) !== "false";
}

function storeHidden(value: boolean): void {
  safeWrite(HIDDEN_STORAGE_KEY, value ? "true" : "false");
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, embedded webview); the
    // preference simply does not persist.
  }
}
