# Explorer Focus

A Visual Studio Code extension that adds a **Focused Repos** panel to the Explorer. It lists every git repository in your multi-repo workspace with a checkbox, so you can show or hide each repo's files in the native Explorer with one click.

## Why

VS Code's Source Control view lets you pick which repositories to work on via its Repositories list, but that selection does not carry over to the Explorer — the Explorer always shows every folder. This extension gives you a per-repo visibility toggle that drives the Explorer directly.

## How it works

The panel lists every git repository that VS Code's built-in Git extension has detected in the workspace (via its API — not a filesystem scan), so the list matches the repos VS Code itself knows about. Selecting repos in the panel drives their visibility in the Explorer:

- **Click a repo** — focus it: only that repo stays visible, all others are hidden.
- **Cmd/Ctrl+click** — add or remove a repo from the focused set.
- **Shift+click** — select a range.
- **Clicking empty space** — keeps the current focus (does not hide everything).

Hidden repos are added to `files.exclude` (Workspace scope, or Workspace Folder scope in a multi-root `.code-workspace`), removing them from the Explorer, Quick Open, and search.

Each session starts with all repos visible, so a stale selection never leaves repos hidden out of sync with the panel.

## Features

- Selection-driven repo list in the Explorer, sourced from the Git extension API.
- Multi-select with Cmd/Ctrl and Shift, like the Source Control Repositories list.
- Toolbar buttons: **Show All**, **Hide All**, **Refresh**.
- Auto-refreshes when repos open/close or `files.exclude` changes.

## Notes

- Hiding a repo writes to `files.exclude`. The entry is removed when the repo is focused again.
- A workspace folder that is itself a git repo root is skipped, since its own root cannot be excluded from itself.
- Repos outside any open workspace folder are skipped, since a `files.exclude` entry cannot be scoped to them.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## License

MIT
