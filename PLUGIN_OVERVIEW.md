Browse, search, diff and edit the files of the workspace behind a thread,
laid out the way Conductor does it.

## What you get

- A **Files** tab beside every thread, with **All files** and **Changes**.
- Changes with **Viewed**, a viewed filter, **Discard changes** and
  **Pull latest from main**.
- Diffs in BB's own renderer, split or unified.
- A **Monaco** editor that autosaves, and stops instead of overwriting when an
  agent changed the file underneath you.
- Search in files, go to file by name, and find in file.
- A `bb files` command so agents get the same listing from the CLI.

## How it works

Listing, search, discard and pull run in the plugin's host process on the
machine the workspace lives on. Nothing leaves the machine, and the plugin
needs no account, API key or external service.

Built to work with **Conductor UI**, which adds the file and *All changes* tabs
to the thread header.
