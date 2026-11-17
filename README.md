# Workspace Files

A Conductor-style files panel for BB. It shows the files of the workspace
behind a thread — its worktree, or the project's checkout — in the right panel,
and opens them over the chat in a full editor.

Forked from [bb-plugin-files-editor](https://github.com/abdoutelb/bb-plugin-files-editor)
by AbdElrahman Telb (MIT). The file tree, search in files, the CLI and the
search engine come from there; the Conductor layout, the Changes tab, the
Monaco editor and autosave were added in this fork.

## What it gives you

- **A Files tab beside every thread** with a workspace: a fixed tab, like
  BB's own Diff tab, so a thread always has its files one click away.
- **All files.** The file tree of the workspace, with an eye toggle for
  dotfiles and a resizable explorer.
- **Changes.** Every uncommitted file, as a list or a tree, with a **Viewed**
  checkbox per file (shared with BB's own git panel), a filter that hides
  viewed files, **Discard changes** per file, and **Pull latest from main** when
  the branch is behind (fast-forward only; a branch with commits of its own is
  left alone and says so).
- **Diffs in BB's own renderer**, split or unified, with collapsed unchanged
  lines that expand, word highlights, whitespace hiding and line wrapping.
- **A Monaco editor** that autosaves one second after you stop typing. Saves
  are guarded by the hash the file had when it was opened: if an agent changed
  it underneath you, the save stops and offers *Reload* or *Overwrite*.
  Unsaved edits, undo and autosave survive switching back to the chat.
- **Search in files** (<kbd>⌘⇧F</kbd>) across the whole workspace, with match
  case (<kbd>⌥C</kbd>), whole word (<kbd>⌥W</kbd>) and regex (<kbd>⌥R</kbd>);
  **go to file by name** (<kbd>⌘P</kbd>); **find in file** (<kbd>⌘F</kbd>).
- **Markdown** opens rendered, with *Preview / Read / Edit*. Images render;
  other binaries say so instead of dumping bytes.
- **`bb files`** gives an agent the same listing from the CLI.

## Works best with Conductor UI

This plugin is built to sit inside the Conductor layout of
[conductor-ui](https://github.com/promontis/bb-plugin-conductor-ui), which
puts a file tab and an *All changes* tab next to the chats in the thread
header. Without it, files still open over the chat from the Files tab, but
there is no tab in the header to switch back and forth.

The two plugins talk through browser events, `localStorage` keys and one
route, not a BB API:

| kind | name |
|---|---|
| event | `workspace-files:thread-file` |
| event | `workspace-files:open-first-change` |
| localStorage | `workspace-files:last:<environmentId>` |
| localStorage | `workspace-files:last-change:<environmentId>` |
| route | `/plugins/workspace-files/editor/environment/<environmentId>/<path>` |

Renaming one of them on one side breaks the Conductor tabs.

## Known fragile spots

BB has no plugin API for some of what this plugin does, so it leans on BB's
markup and experimental APIs. A BB release can break these without warning:

- **The editor over the chat** is a `position: fixed` layer in `document.body`,
  placed over the element marked `[data-split-pane-id]` and below
  `[data-thread-header-rows]`. If BB renames those attributes, files stop
  opening over the chat.
- **Monaco is bundled by the plugin** into `monaco-assets/` (built on first use
  when missing) and served through `bb.sdk.files.createPreview`. Its popup layer
  uses the same element id as BB's built-in Monaco plugin, so the two share it.
- **Jumping to a line** in BB's source viewer, the fallback while Monaco loads
  or when it fails, finds its scroll container with
  `[class*="overflow-y-auto"]`. If BB changes that class, a search hit opens at
  the wrong place.
- **Viewed** calls BB's git plugin (`bb--git`) with a contract copied into
  `components/use-git-file.ts`; BB does not publish that contract.
- Many slots and hooks are `experimental_` in the BB plugin SDK.

## Waiting on BB

The plan is for this plugin to stop shipping its own editor. BB already has
one: the built-in `monaco-editor` plugin registers as a `fileOpener`, and the
user picks the editor per file type under Settings → File openers. But BB only
uses that choice when it opens a file itself (`openFilePreview`), and then the
file lands in a side-panel tab. A plugin cannot ask BB to render the user's
chosen editor in its own view: `experimental_FilePreview` always shows BB's
read-only preview.

So the plugin keeps its own Monaco, and the fallback viewer with it, until BB
can open files in the thread's main area:

- [get-bb/bb#7707](https://github.com/get-bb/bb/issues/7707) asks for a slot
  in place of the timeline and a setting for where files open (side panel or
  main area). Once it lands, this plugin opens files with
  `openFilePreview` and lets BB pick the editor and the place. The overlay,
  the bundled Monaco and the fallback viewer go away.
- [get-bb/bb#7710](https://github.com/get-bb/bb/issues/7710) asks for the side
  panel and open files to belong to the environment instead of the thread.
  With that, Conductor UI can read open files from BB, and the events,
  `localStorage` keys and route in the table above go away, except
  `workspace-files:open-first-change`: BB has no intent to open a diff yet,
  so *All changes* still asks this plugin directly.

Until then, switching to BB's editor would mean opening files in the side
panel instead of over the chat, and giving up autosave (BB's editor saves
with a button or <kbd>⌘S</kbd>).

## Search in files

The search engine is the plugin's own (there is no ripgrep to call), built for
refining a query while you type:

- **File contents stay in memory between searches**, re-checked against each
  file's size and modification time.
- **The file list is reused while you type**, instead of walking the workspace
  for every keystroke.
- **Every search cancels the one it replaces.**
- **It runs where the files are**, in the plugin's host process on the machine
  the workspace lives on, so only the matches travel back.
- **A regex cannot freeze the search.** It runs in its own worker thread with a
  3-second deadline.

It is smart case: `discount` finds any case, `Discount` only that one.

## The CLI

```
bb files root                 # where the workspace is, and on which machine
bb files tree [--depth n] [--all] [--limit n]
bb files find <query> [--limit n]
bb files read <path>
```

Everything resolves against the thread the command runs in. It reads through
BB, so it returns the right bytes even when the workspace lives on another
machine.

## Settings

**Excluded directories** — one name per line, matched against any path segment.
Defaults to `.git`, `node_modules` and `vendor`. Applies to the tree, the
palette, search and the CLI.

## Install

```sh
bb plugin install git:https://github.com/promontis/bb-plugin-workspace-files.git@^0.2.0
```

To work on it locally, clone it and install the path:

```sh
bb plugin install path:/path/to/bb-plugin-workspace-files
```

## Development

```sh
npm install --include=dev
npm test
npm run typecheck
bb plugin build .
bb plugin reload workspace-files
```

`lib/` holds the logic that is tested on its own: tree assembly, ranking, find,
text search and its cache, git diff and discard, paths and routes. `host.ts`
runs on the workspace's machine (listing, search, discard, pull); `server.ts`
is mostly wiring; `components/` is the view. `scripts/stage-monaco.mjs` builds
`monaco-assets/` from `monaco-bundle/`.

## Limits

- The listing stops at 40,000 entries; the explorer mounts at most 600 rows at
  a time. The footer says when either limit is in play.
- Search in files stops at 2,000 hits, 500 files or 10 seconds, and says so.
  It skips binaries and files over 2 MB.
- File contents are re-checked at most every 3 seconds, so an edit made
  outside the editor shows up in search results within that long.
- Files over 4 MB open read-only.
- Every `bb files` command is capped by BB's 1 MB limit on command output; past
  that it prints what fits and says how much it cut.
- The tree does not create, rename or delete files.

## License

MIT. See [LICENSE](LICENSE).
