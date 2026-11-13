import { useEffect, useRef } from "react";
import type * as MonacoNs from "monaco-editor";
import { languageForPath } from "@/lib/monaco/languages";
import { BASE_EDITOR_OPTIONS, overflowWidgetsNode } from "./use-monaco";

type Monaco = typeof MonacoNs;

/**
 * One file in Monaco. Read mode is the same editor set read-only, so reading
 * and editing look identical. Mount it keyed by path: a new path is a new model.
 */
export function MonacoEditor({
  monaco,
  path,
  value,
  readOnly,
  onChange,
  onSave,
  reveal,
  findRequest,
}: {
  monaco: Monaco;
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  reveal: { line: number; nonce: number } | null;
  findRequest: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  // Set while this component writes the model itself, so that write is not
  // reported back as an edit.
  const applyingRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const model = monaco.editor.createModel(value, languageForPath(path));
    const editor = monaco.editor.create(container, {
      ...BASE_EDITOR_OPTIONS,
      model,
      readOnly,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      if (!applyingRef.current) onChangeRef.current(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
    return () => {
      subscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // The editor lives for one path; value and readOnly sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, path]);

  // A reload, discard or save from outside replaces the text.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || editor.getValue() === value) return;
    applyingRef.current = true;
    try {
      editor.setValue(value);
    } finally {
      applyingRef.current = false;
    }
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
