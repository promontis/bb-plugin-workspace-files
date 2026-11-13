import { useEffect } from "react";
import {
  experimental_useAppPanel as useAppPanel,
  type ExperimentalTabReference,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";

/**
 * Conductor's right panel: views on top, a terminal below. BB has no plugin API
 * for its side-panel split, so once per thread — and only while BB has no
 * stored layout for it — this opens a thread terminal and moves it to the
 * bottom with BB's own "Pane arrangement → Move bottom" control. BB then
 * stores that layout itself. If the control is not found, nothing changes.
 */
const DONE_PREFIX = "workspace-files:default-terminal-split:";
const BB_SPLIT_PREFIX = "bb.thread.secondaryPanelSplitLayout.";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found !== null) return found;
    if (Date.now() > deadline) return null;
    await wait(50);
  }
}

/** Move the side panel's active tab (the terminal just opened) to a bottom pane. */
async function moveActiveTabToBottom(): Promise<boolean> {
  const trigger = await waitFor(
    () =>
      document.querySelector<HTMLButtonElement>(
        '[data-testid="thread-secondary-panel-top-chrome"] button[aria-haspopup="menu"]',
      ),
    3000,
  );
  if (trigger === null) return false;
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  const moveBottom = await waitFor(
    () =>
      document.querySelector<HTMLButtonElement>(
        '[role="menu"][aria-label="Pane arrangement"] button[aria-label="Move bottom"]',
      ),
    2000,
  );
  if (moveBottom === null) {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  moveBottom.click();
  return true;
}

export function useDefaultTerminalSplit({
  threadId,
  enabled,
  topTab,
}: {
  threadId: string;
  enabled: boolean;
  /** The tab to show above the terminal. */
  topTab: ExperimentalTabReference & { availability: "action" };
}): void {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const panel = useAppPanel();

  useEffect(() => {
    if (!enabled) return;
    const doneKey = `${DONE_PREFIX}${threadId}`;
    if (read(doneKey) !== null || read(`${BB_SPLIT_PREFIX}${threadId}`) !== null) return;
    let cancelled = false;
    void (async () => {
      // Let BB's panel mount first.
      await wait(800);
      if (cancelled) return;
      const listed = await sdk.terminals.list({ scope: { kind: "thread", threadId } });
      const running = listed.sessions.find((session) => session.status === "running");
      const terminal =
        running ?? (await sdk.terminals.create({ scope: { kind: "thread", threadId }, cols: 100, rows: 24 }));
      if (cancelled) return;
      if (!(await navigate.experimental_openTerminal({ terminalId: terminal.id }))) return;
      await wait(300);
      if (cancelled || !(await moveActiveTabToBottom())) return;
      try {
        window.localStorage.setItem(doneKey, String(Date.now()));
      } catch {
        // Without storage it may run again on the next visit; BB's own stored
        // layout then stops it anyway.
      }
      await wait(200);
      panel.openTab({ tab: topTab, title: "Files" });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Once per thread; the SDK handles are stable for the surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, threadId]);
}
