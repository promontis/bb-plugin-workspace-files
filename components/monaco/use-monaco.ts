import { useEffect, useState } from "react";
import type * as MonacoNs from "monaco-editor";
import { experimental_useCodeTheme as useCodeTheme, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server.js";
import { loadMonaco, overflowWidgetsNode, setOverflowWidgetsTheme } from "@/lib/monaco/loader";
import { applyCodeTheme } from "@/lib/monaco/theme";

/** Conductor sets code in Geist Mono 13px on 20px lines, with ligatures. */
export const CODE_FONT_FAMILY = '"Conductor Geist Mono", ui-monospace, "SFMono-Regular", monospace';

export const BASE_EDITOR_OPTIONS: MonacoNs.editor.IEditorOptions = {
  fontFamily: CODE_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 20,
  fontLigatures: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 12 },
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  guides: { indentation: false },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  renderLineHighlight: "line",
  // Conductor keeps brackets in the text colour.
  bracketPairColorization: { enabled: false },
  stickyScroll: { enabled: false },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  fixedOverflowWidgets: true,
};

let monacoPromise: Promise<typeof MonacoNs> | null = null;

/**
 * Monaco, loaded once from the plugin's bundle and kept on BB's active code
 * theme (the Conductor palette ships Conductor's colours). `null` until it is
 * ready; `error` set when it cannot load, so callers fall back to BB's viewer.
 */
export function useMonaco(): { monaco: typeof MonacoNs | null; error: string | null } {
  const rpc = useRpc<typeof rpcContract>();
  const codeTheme = useCodeTheme();
  const [monaco, setMonaco] = useState<typeof MonacoNs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    monacoPromise ??= (async () => {
      const { baseUrl } = await rpc.call("monacoAssets");
      const loaded = await loadMonaco(baseUrl);
      // Monaco measures glyphs once; measure after the code font is in.
      try {
        await document.fonts.load(`13px ${CODE_FONT_FAMILY}`);
      } catch {
        // A missing font only means the fallback mono is measured.
      }
      loaded.editor.remeasureFonts();
      return loaded;
    })();
    monacoPromise.then(
      (loaded) => {
        if (!cancelled) setMonaco(loaded);
      },
      (cause: unknown) => {
        monacoPromise = null;
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Monaco");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => {
    if (monaco === null) return;
    const applied = applyCodeTheme(monaco, codeTheme);
    monaco.editor.setTheme(applied.name);
    setOverflowWidgetsTheme(applied.base);
  }, [monaco, codeTheme]);

  return { monaco, error };
}

export { overflowWidgetsNode };
