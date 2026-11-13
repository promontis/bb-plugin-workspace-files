// Builds monaco-assets/ (editor.js, editor.css, editor.worker.js) from the
// monaco-editor package. Adapted from BB's built-in Monaco file editor
// (plugins/monaco-editor/scripts/stage-assets.mjs), MIT licensed.
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(pluginRoot, "package.json"));
const esbuild = require("esbuild");

const outDir = path.join(pluginRoot, "monaco-assets");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  absWorkingDir: pluginRoot,
  loader: { ".ttf": "dataurl" },
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "editor.js")],
  outfile: path.join(outDir, "editor.js"),
});
await esbuild.build({
  ...shared,
  entryPoints: [path.join(pluginRoot, "monaco-bundle", "worker.js")],
  outfile: path.join(outDir, "editor.worker.js"),
});
console.log(`monaco: built ${outDir}`);
