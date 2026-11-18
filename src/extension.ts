import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const EXCLUDE_KEY = 'exclude';

interface Repo {
  /** Absolute path to the repo directory. */
  absPath: string;
  /** The workspace folder that contains this repo. */
  folder: vscode.WorkspaceFolder;
  /** Path relative to the workspace folder, POSIX separators. Used as the files.exclude glob and as the repo id. */
  relPath: string;
  /** Display label. */
  label: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Recursively find git repos under a directory, up to maxDepth levels deep. */
function findRepos(root: string, maxDepth: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      found.push(dir);
      return; // don't descend into a repo looking for nested repos
    }
    if (depth >= maxDepth) {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

function discoverRepos(): Repo[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const depth = vscode.workspace
    .getConfiguration('explorerFocus')
    .get<number>('scanDepth', 2);
  const repos: Repo[] = [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    for (const abs of findRepos(root, depth)) {
      const rel = toPosix(path.relative(root, abs));
      if (rel === '') {
        // The workspace folder itself is a repo — can't exclude its own root.
        continue;
      }
      repos.push({
        absPath: abs,
        folder,
        relPath: rel,
        label: rel,
      });
    }
  }
  repos.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return repos;
}

class RepoItem extends vscode.TreeItem {
  constructor(public readonly repo: Repo, hidden: boolean) {
    super(repo.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${repo.folder.uri.fsPath}::${repo.relPath}`;
    this.resourceUri = vscode.Uri.file(repo.absPath);
    this.iconPath = new vscode.ThemeIcon('repo');
    this.description = hidden ? 'hidden' : undefined;
    this.tooltip = repo.absPath;
    this.checkboxState = hidden
      ? vscode.TreeItemCheckboxState.Unchecked
      : vscode.TreeItemCheckboxState.Checked;
  }
}

class RepoProvider implements vscode.TreeDataProvider<RepoItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private repos: Repo[] = [];

  refresh(): void {
    this.repos = discoverRepos();
    this._onDidChange.fire();
  }

  getRepos(): Repo[] {
    return this.repos;
  }

  getTreeItem(element: RepoItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RepoItem[] {
    if (this.repos.length === 0) {
      this.repos = discoverRepos();
    }
    return this.repos.map((r) => new RepoItem(r, isHidden(r)));
  }
}

/** Current files.exclude map for a workspace folder (Workspace-scoped merge). */
function getExcludeMap(folder: vscode.WorkspaceFolder): Record<string, boolean> {
  const cfg = vscode.workspace.getConfiguration('files', folder.uri);
  return { ...(cfg.get<Record<string, boolean>>('exclude') ?? {}) };
}

function isHidden(repo: Repo): boolean {
  const map = getExcludeMap(repo.folder);
  return map[repo.relPath] === true;
}

/**
 * Which configuration target to write files.exclude to.
 * WorkspaceFolder is only valid in a multi-root (.code-workspace) session;
 * for a single open folder it throws, so fall back to Workspace there.
 */
function excludeTarget(): vscode.ConfigurationTarget {
  const isMultiRoot = !!vscode.workspace.workspaceFile;
  return isMultiRoot
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Workspace;
}

/** Hide or show every repo in one write per workspace folder. */
async function setAllHidden(repos: Repo[], hidden: boolean): Promise<void> {
  const byFolder = new Map<string, Repo[]>();
  for (const r of repos) {
    const key = r.folder.uri.toString();
    (byFolder.get(key) ?? byFolder.set(key, []).get(key)!).push(r);
  }
  for (const group of byFolder.values()) {
    const folder = group[0].folder;
    const cfg = vscode.workspace.getConfiguration('files', folder.uri);
    const map = { ...(cfg.get<Record<string, boolean>>('exclude') ?? {}) };
    for (const r of group) {
      if (hidden) {
        map[r.relPath] = true;
      } else {
        delete map[r.relPath];
      }
    }
    try {
      await cfg.update(EXCLUDE_KEY, map, excludeTarget());
    } catch (err) {
      vscode.window.showErrorMessage(
        `Explorer Focus: could not update files.exclude: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new RepoProvider();
  const view = vscode.window.createTreeView('explorerFocus.repos', {
    treeDataProvider: provider,
    manageCheckboxStateManually: true,
  });

  provider.refresh();

  context.subscriptions.push(
    view,
    view.onDidChangeCheckboxState(async (e) => {
      const toHide: Repo[] = [];
      const toShow: Repo[] = [];
      for (const [item, state] of e.items) {
        if (state === vscode.TreeItemCheckboxState.Unchecked) {
          toHide.push(item.repo);
        } else {
          toShow.push(item.repo);
        }
      }
      if (toHide.length) {
        await setAllHidden(toHide, true);
      }
      if (toShow.length) {
        await setAllHidden(toShow, false);
      }
      provider.refresh();
    }),
    vscode.commands.registerCommand('explorerFocus.refresh', () =>
      provider.refresh()
    ),
    vscode.commands.registerCommand('explorerFocus.showAll', async () => {
      await setAllHidden(provider.getRepos(), false);
      provider.refresh();
    }),
    vscode.commands.registerCommand('explorerFocus.hideAll', async () => {
      await setAllHidden(provider.getRepos(), true);
      provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('files.exclude') ||
        e.affectsConfiguration('explorerFocus.scanDepth')
      ) {
        provider.refresh();
      }
    })
  );
}

export function deactivate() {}
