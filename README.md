# Explorer Focus

A Visual Studio Code extension that adds a **Focused Repos** panel to the Explorer. It lists every git repository in your multi-repo workspace with a checkbox, so you can show or hide each repo's files in the native Explorer with one click.

## Why

VS Code's Source Control view lets you pick which repositories to work on via its Repositories list, but that selection does not carry over to the Explorer — the Explorer always shows every folder. This extension gives you a per-repo visibility toggle that drives the Explorer directly.

## How it works

The panel discovers git repositories (directories containing a `.git` entry) up to a configurable depth below each workspace folder. Each repo gets a checkbox:

- **Checked** — the repo is visible in the Explorer.
- **Unchecked** — the repo's folder is added to `files.exclude` (at Workspace Folder scope), hiding it from the Explorer, Quick Open, and search.

Because it uses the standard `files.exclude` setting, hidden repos stay out of the way everywhere, not just visually.

## Features

- Checkbox list of all repos in the workspace, inside the Explorer.
- Toolbar buttons: **Show All**, **Hide All**, **Refresh**.
- Auto-refreshes when workspace folders or `files.exclude` change.
- Configurable scan depth.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `explorerFocus.scanDepth` | `2` | Directory levels below each workspace folder to search for git repositories. |

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## Notes

- Hiding a repo writes to the workspace's `files.exclude`. The setting is restored (the entry removed) when you re-check the repo.
- A workspace folder that is itself a git repo root is skipped, since its own root cannot be excluded from itself.

## License

MIT
