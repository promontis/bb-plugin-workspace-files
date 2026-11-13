// The worker entry that starts itself on the first message. BB's bundle
// imports editor.worker.start.js, which only defines `start` and never runs
// it, so its worker never answers — and the diff editor needs the worker.
import "monaco-editor/editor/editor.worker.js";
