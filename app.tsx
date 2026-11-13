import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ThreadTitle,
  definePluginApp,
  experimental_useAppPanel as useAppPanel,
  experimental_usePanelTabs as usePanelTabs,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type ExperimentalTabReference,
  type ExperimentalThreadHeaderRowProps,
  type ExperimentalThreadTabProps,
  type PluginNavPanelProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import "@/components/ui/icon-extended";
import { Icon } from "@/components/ui/icon";
import { formatRoute, parseRoute, type ScopeRef } from "@/lib/route";
import { Workspace } from "@/components/Workspace";
import { useGitChanges } from "@/components/use-git-file";

const PANEL_PATH = "editor";
const LAST_FILE_PREFIX = "workspace-files:last:";
const THREAD_FILE_EVENT = "workspace-files:thread-file";
const THREAD_FILES_TAB = {
  context: { kind: "thread" },
  availability: "action",
  id: "files",
} as const satisfies ExperimentalTabReference;
const EDITOR_FILES_TAB = {
  context: { kind: "nav-panel", panelId: PANEL_PATH },
  availability: "action",
  id: "files",
} as const satisfies ExperimentalTabReference;

function useEnsureFilesTab(
  tab: ExperimentalTabReference & { availability: "action" },
  visible = true,
) {
  const panel = useAppPanel();
  const panelTabs = usePanelTabs();

  useEffect(() => {
    if (!visible || !panelTabs.open) return;
    const alreadyOpen = panelTabs.tabs.some(
      (candidate) =>
        candidate.detail.kind === "plugin" &&
        candidate.detail.tab.id === tab.id &&
        candidate.detail.tab.context.kind === tab.context.kind,
    );
    if (alreadyOpen) return;

    const previousTab = panelTabs.selectedKey;
    if (!panel.openTab({ tab, title: "Files" })) return;
    if (previousTab !== null) {
      queueMicrotask(() => panel.selectTab(previousTab));
    }
  }, [panel, panelTabs.open, panelTabs.selectedKey, panelTabs.tabs, tab, visible]);
}

type ThreadFileEventDetail = {
  threadId: string;
  environmentId: string;
  path: string | null;
  active: boolean;
  /** Conductor's leading tab for the file: the file tab, or All changes. */
  surface?: "file" | "changes";
};

const FIRST_CHANGE_EVENT = "workspace-files:open-first-change";
const LAST_CHANGE_PREFIX = "workspace-files:last-change:";

function rememberChange(environmentId: string, path: string) {
  try {
    window.localStorage.setItem(`${LAST_CHANGE_PREFIX}${environmentId}`, path);
  } catch {
    // Only restores the All changes tab.
  }
}

function emitThreadFile(detail: ThreadFileEventDetail) {
  window.dispatchEvent(new CustomEvent<ThreadFileEventDetail>(THREAD_FILE_EVENT, { detail }));
}

function useThreadFile(
  threadId: string,
  environmentId: string | null,
): { path: string | null; active: boolean } {
  const [file, setFile] = useState<{ path: string | null; active: boolean }>({
    path: null,
    active: false,
  });

  useEffect(() => {
    setFile({ path: null, active: false });
    if (environmentId === null) return;
    const onFile = (event: Event) => {
      const detail = (event as CustomEvent<ThreadFileEventDetail>).detail;
      if (detail.threadId !== threadId || detail.environmentId !== environmentId) return;
      setFile({ path: detail.path, active: detail.active });
    };
    window.addEventListener(THREAD_FILE_EVENT, onFile);
    return () => window.removeEventListener(THREAD_FILE_EVENT, onFile);
  }, [environmentId, threadId]);

  return file;
}

function EnsureThreadFilesTab({
  threadId,
  environment,
}: ExperimentalThreadHeaderRowProps) {
  useEnsureFilesTab(THREAD_FILES_TAB, environment !== null);
  const environmentId = environment?.id ?? null;
  const file = useThreadFile(threadId, environmentId);
  // Conductor's All changes tab, clicked before any change was opened: show
  // the first changed file.
  const changes = useGitChanges(environmentId);
  const firstChange = changes.files[0]?.path ?? null;
  useEffect(() => {
    if (environmentId === null) return;
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string; environmentId: string }>).detail;
      if (detail.threadId !== threadId || detail.environmentId !== environmentId) return;
      if (firstChange === null) return;
      rememberChange(environmentId, firstChange);
      emitThreadFile({ threadId, environmentId, path: firstChange, active: true, surface: "changes" });
    };
    window.addEventListener(FIRST_CHANGE_EVENT, onRequest);
    return () => window.removeEventListener(FIRST_CHANGE_EVENT, onRequest);
  }, [environmentId, firstChange, threadId]);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [overlay, setOverlay] = useState<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const target = anchor?.closest<HTMLElement>("[data-split-pane-id]") ?? null;
    const rows = anchor?.closest<HTMLElement>("[data-thread-header-rows]") ?? null;
    if (!file.active || target === null || rows === null) {
      setOverlay(null);
      return;
    }

    const update = () => {
      const targetBox = target.getBoundingClientRect();
      const rowsBox = rows.getBoundingClientRect();
      setOverlay({
        top: Math.max(targetBox.top, rowsBox.bottom),
        right: Math.max(0, window.innerWidth - targetBox.right),
        bottom: Math.max(0, window.innerHeight - targetBox.bottom),
        left: Math.max(0, targetBox.left),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    observer.observe(rows);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [file.active]);

  const onOpenPath = useCallback(
    (path: string | null) => {
      if (environmentId === null || path === null) return;
      const scope = { kind: "environment", id: environmentId } as const;
      rememberFile(scope, path);
      emitThreadFile({ threadId, environmentId, path, active: true });
    },
    [environmentId, threadId],
  );

  return (
    <>
      <span ref={anchorRef} className="hidden" />
      {overlay !== null && environmentId !== null && file.path !== null
        ? createPortal(
            <div
              data-bb-plugin-root=""
              data-bb-plugin="workspace-files"
              className="flex min-h-0 flex-col overflow-hidden bg-background"
              style={{
                position: "fixed",
                top: overlay.top,
                right: overlay.right,
                bottom: overlay.bottom,
                left: overlay.left,
                zIndex: 40,
                background: "var(--background)",
              }}
            >
              <Workspace
                scope={{ kind: "environment", id: environmentId }}
                filePath={file.path}
                onOpenPath={onOpenPath}
                variant="page"
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function workspaceChats(threads: readonly PluginSidebarThread[], environmentId: string) {
  return threads
    .filter(
      (thread) =>
        thread.environment?.id === environmentId &&
        !thread.isArchived &&
        !thread.isHidden &&
        thread.parentThreadId === null,
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function pathLeaf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function workspaceLabel(environment: NonNullable<PluginSidebarThread["environment"]>): string {
  if (environment.name?.trim()) return environment.name;
  if (environment.branchName !== null) {
    return environment.branchName.slice(environment.branchName.lastIndexOf("/") + 1);
  }
  return environment.path === null ? "Workspace" : pathLeaf(environment.path);
}

function WorkspaceHeaderTitle({ subPath }: PluginNavPanelProps) {
  const route = useMemo(() => parseRoute(subPath), [subPath]);
  const { threads, projects } = useSidebarThreads();
  const anchor =
    route.scope?.kind === "environment"
      ? threads.find((thread) => thread.environment?.id === route.scope?.id)
      : route.scope?.kind === "thread"
        ? threads.find((thread) => thread.id === route.scope?.id)
        : undefined;
  const projectId =
    route.scope?.kind === "project" ? route.scope.id : anchor?.projectId;
  const project = projects.find((entry) => entry.id === projectId);
  const projectName = project === undefined ? "Personal" : project.isPersonal ? "Personal" : project.name;
  const label =
    anchor?.environment === null || anchor?.environment === undefined
      ? anchor?.displayTitle ?? route.scope?.id ?? "Workspace"
      : workspaceLabel(anchor.environment);

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium text-muted-foreground">
        {projectName.slice(0, 1).toUpperCase()}
      </span>
      <span className="shrink-0 truncate text-muted-foreground">{projectName}</span>
      <Icon name="ChevronRight" className="size-3.5 shrink-0 text-subtle-foreground" />
      <span className="min-w-0 truncate text-foreground">{label}</span>
    </span>
  );
}

function WorkspaceTabStrip({ environmentId, filePath }: { environmentId: string; filePath: string }) {
  const { threads } = useSidebarThreads();
  const chats = workspaceChats(threads, environmentId);
  const label = filePath.split("/").at(-1) ?? filePath;
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border-hairline px-2 [scrollbar-width:none]">
      <div className="relative flex max-w-56 min-w-0 shrink-0 items-center gap-1.5 px-2.5 text-sm text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground">
        <Icon name="File" className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      {chats.map((thread) => (
        <div key={thread.id} className="relative flex max-w-56 min-w-0 shrink-0 items-center px-2.5 text-sm text-muted-foreground hover:text-foreground">
          <a href={thread.href} className="absolute inset-0 rounded-md" aria-label={thread.displayTitle} />
          <span className="pointer-events-none truncate"><ThreadTitle threadId={thread.id} /></span>
        </div>
      ))}
    </div>
  );
}

function rememberFile(scope: ScopeRef | null, path: string | null) {
  if (scope?.kind !== "environment" || path === null) return;
  const label = path.split("/").at(-1) ?? path;
  try {
    window.localStorage.setItem(
      `${LAST_FILE_PREFIX}${scope.id}`,
      JSON.stringify({ path, label }),
    );
  } catch {
    // Storage is only a convenience for Conductor's leftmost tab.
  }
}

function FilesPage({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const route = useMemo(() => parseRoute(subPath), [subPath]);
  useEnsureFilesTab(EDITOR_FILES_TAB);

  useEffect(() => rememberFile(route.scope, route.filePath), [route.filePath, route.scope]);

  const onOpenPath = useCallback(
    (path: string | null) => {
      if (route.scope === null) return;
      if (route.filePath === path) return;
      rememberFile(route.scope, path);
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: formatRoute(route.scope, path),
        replace: true,
      });
    },
    [navigate, route.filePath, route.scope],
  );

  const workspace = (
    <Workspace scope={route.scope} filePath={route.filePath} onOpenPath={onOpenPath} variant="page" />
  );
  if (route.scope?.kind !== "environment" || route.filePath === null) return workspace;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <WorkspaceTabStrip environmentId={route.scope.id} filePath={route.filePath} />
      {workspace}
    </div>
  );
}

function ExplorerPanel({ scope, filePath }: { scope: ScopeRef; filePath: string | null }) {
  const navigate = useBbNavigate();
  const onOpenPath = useCallback(
    (path: string | null) => {
      if (path === null) return;
      rememberFile(scope, path);
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: formatRoute(scope, path),
        replace: true,
      });
    },
    [navigate, scope],
  );
  return <Workspace scope={scope} filePath={filePath} onOpenPath={onOpenPath} variant="panel" />;
}

function ThreadFilesPanel({ threadId, environment }: ExperimentalThreadTabProps) {
  const environmentId = environment?.id ?? null;
  const file = useThreadFile(threadId, environmentId);
  const onOpenPath = useCallback(
    (path: string | null) => {
      if (environmentId === null || path === null) return;
      const scope = { kind: "environment", id: environmentId } as const;
      rememberFile(scope, path);
      emitThreadFile({ threadId, environmentId, path, active: true });
    },
    [environmentId, threadId],
  );
  const onOpenChange = useCallback(
    (path: string) => {
      if (environmentId === null) return;
      rememberChange(environmentId, path);
      emitThreadFile({ threadId, environmentId, path, active: true, surface: "changes" });
    },
    [environmentId, threadId],
  );
  if (environmentId === null) return null;
  return (
    <Workspace
      scope={{ kind: "environment", id: environmentId }}
      filePath={file.active ? file.path : null}
      onOpenPath={onOpenPath}
      onOpenChange={onOpenChange}
      variant="panel"
    />
  );
}

function EditorFilesPanel({ subPath }: PluginNavPanelProps) {
  const route = useMemo(() => parseRoute(subPath), [subPath]);
  if (route.scope === null) return null;
  return <ExplorerPanel scope={route.scope} filePath={route.filePath} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "editor",
    title: "Files",
    icon: "FolderOpen",
    path: PANEL_PATH,
    component: FilesPage,
    experimental_headerTitle: WorkspaceHeaderTitle,
    experimental_hideFromNavigation: true,
  });

  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "files",
    title: "Files",
    icon: "FolderOpen",
    layout: "flush",
    component: ThreadFilesPanel,
    useVisible: ({ environment }) => environment !== null,
  });

  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: "editor" },
    availability: "action",
    id: "files",
    title: "Files",
    icon: "FolderOpen",
    layout: "flush",
    component: EditorFilesPanel,
  });

  app.slots.experimental_threadHeaderRow({
    id: "ensure-files-tab",
    component: EnsureThreadFilesTab,
  });
});
