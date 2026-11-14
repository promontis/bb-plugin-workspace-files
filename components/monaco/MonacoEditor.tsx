import { useEffect, useRef } from "react";
import type * as MonacoNs from "monaco-editor";
import { languageForPath } from "@/lib/monaco/languages";
import { BASE_EDITOR_OPTIONS, overflowWidgetsNode } from "./use-monaco";

type Monaco = typeof MonacoNs;

interface CachedModel {
  model: MonacoNs.editor.ITextModel;
  viewState: MonacoNs.editor.ICodeEditorViewState | null;
}

/**
 * The open files in one Monaco editor. Read mode is the same editor set
 * read-only, so reading and editing look identical.
 *
 * The editor lives as long as this component. A new path swaps the model, as
 * VS Code and Conductor do: no new editor, no re-layout, and each file keeps
 * its own scroll position, cursor and undo history. Models of files that are
 * no longer in `openPaths` are disposed.
 */
export function MonacoEditor({
  monaco,
  path,
  value,
  readOnly,
  openPaths,
  onChange,
  onSave,
  reveal,
  findRequest,
}: {
  monaco: Monaco;
  path: string;
  value: string;
  readOnly: boolean;
  /** Every path that has a tab; the cached models of other paths are disposed. */
  openPaths: readonly string[];
  onChange: (next: string) => void;
  onSave: () => void;
  reveal: { line: number; nonce: number } | null;
  findRequest: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, CachedModel>());
  // The path whose model the editor shows.
  const shownPathRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  // Set while this component writes the model itself, so that write is not
  // reported back as an edit.
  const applyingRef = useRef(false);

  const writeModel = (model: MonacoNs.editor.ITextModel, next: string) => {
    if (model.getValue() === next) return;
    applyingRef.current = true;
    try {
      model.setValue(next);
    } finally {
      applyingRef.current = false;
    }
  };

  const modelFor = (forPath: string, content: string): CachedModel => {
    const cached = modelsRef.current.get(forPath);
    if (cached !== undefined && !cached.model.isDisposed()) return cached;
    const created: CachedModel = {
      model: monaco.editor.createModel(content, languageForPath(forPath)),
      viewState: null,
    };
    modelsRef.current.set(forPath, created);
    return created;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const models = modelsRef.current;
    const editor = monaco.editor.create(container, {
      ...BASE_EDITOR_OPTIONS,
      model: modelFor(path, value).model,
      readOnly,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
    editorRef.current = editor;
    shownPathRef.current = path;
    const subscription = editor.onDidChangeModelContent(() => {
      if (!applyingRef.current) onChangeRef.current(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
    return () => {
      subscription.dispose();
      editor.dispose();
      for (const cached of models.values()) cached.model.dispose();
      models.clear();
      editorRef.current = null;
      shownPathRef.current = null;
    };
    // One editor per mount; path, value and readOnly sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco]);

  // Another file: keep the editor, swap the model and restore its view.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const shown = shownPathRef.current;
    if (shown === path) return;
    if (shown !== null) {
      const previous = modelsRef.current.get(shown);
      if (previous !== undefined) previous.viewState = editor.saveViewState();
    }
    const next = modelFor(path, value);
    // The file may have changed on disk since this model last showed it.
    writeModel(next.model, value);
    editor.setModel(next.model);
    editor.updateOptions({ readOnly });
    if (next.viewState !== null) editor.restoreViewState(next.viewState);
    shownPathRef.current = path;
    // value and readOnly are read for the new path only; their own effects
    // handle later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // A closed tab's model is no longer needed.
  const openKey = openPaths.join("\0");
  useEffect(() => {
    const open = new Set(openKey.split("\0"));
    for (const [cachedPath, cached] of modelsRef.current) {
      if (open.has(cachedPath) || cachedPath === shownPathRef.current) continue;
      cached.model.dispose();
      modelsRef.current.delete(cachedPath);
    }
  }, [openKey]);

  // A reload, discard or save from outside replaces the text.
  useEffect(() => {
    const model = editorRef.current?.getModel() ?? null;
    if (model === null) return;
    writeModel(model, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || reveal === null) return;
    editor.revealLineInCenter(reveal.line);
    editor.setPosition({ lineNumber: reveal.line, column: 1 });
  }, [reveal?.nonce, reveal?.line, reveal]);

  // ⌘F opens Monaco's own find widget.
  useEffect(() => {
    if (findRequest <= 0) return;
    const editor = editorRef.current;
    if (editor === null) return;
    editor.focus();
    void editor.getAction("actions.find")?.run();
  }, [findRequest]);

  return <div ref={containerRef} data-workspace-files-monaco="" className="min-h-0 flex-1" />;
}
