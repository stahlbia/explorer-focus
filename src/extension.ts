import * as vscode from 'vscode';
import * as path from 'path';
import type { API as GitAPI, GitExtension } from './git';

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

/** Resolve the built-in Git extension API, activating it if needed. */
async function getGitAPI(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    return undefined;
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  if (!exports.enabled) {
    return undefined;
  }
  return exports.getAPI(1);
}

/** Build Repo entries from the git API's known repositories. */
function reposFromGit(api: GitAPI): Repo[] {
  const repos: Repo[] = [];
  for (const r of api.repositories) {
    const folder = vscode.workspace.getWorkspaceFolder(r.rootUri);
    if (!folder) {
      // Repo lives outside any open workspace folder — we can't scope a
      // files.exclude entry to it, so skip it.
      continue;
    }
    const abs = r.rootUri.fsPath;
    const rel = toPosix(path.relative(folder.uri.fsPath, abs));
    if (rel === '' || rel.startsWith('..')) {
      // The workspace folder itself is the repo root (can't exclude its own
      // root), or the repo is not actually under the folder.
      continue;
    }
    repos.push({
      absPath: abs,
      folder,
      relPath: rel,
      label: rel,
    });
  }
  repos.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return repos;
}

class RepoItem extends vscode.TreeItem {
  constructor(public readonly repo: Repo, focused: boolean) {
    super(repo.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${repo.folder.uri.fsPath}::${repo.relPath}`;
    this.resourceUri = vscode.Uri.file(repo.absPath);
    this.iconPath = new vscode.ThemeIcon(focused ? 'eye' : 'eye-closed');
    this.description = focused ? undefined : 'hidden';
    this.tooltip = repo.absPath;
  }
}

class RepoProvider implements vscode.TreeDataProvider<RepoItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private repos: Repo[] = [];

  constructor(private api: GitAPI | undefined) {}

  setApi(api: GitAPI | undefined): void {
    this.api = api;
    this.refresh();
  }

  refresh(): void {
    this.repos = this.api ? reposFromGit(this.api) : [];
    this._onDidChange.fire();
  }

  getRepos(): Repo[] {
    return this.repos;
  }

  getTreeItem(element: RepoItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RepoItem[] {
    return this.repos.map((r) => new RepoItem(r, !isHidden(r)));
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

/**
 * Make exactly `focused` visible and every other known repo hidden,
 * writing one update per workspace folder. `allRepos` is the full set so
 * we know which repos to exclude.
 */
async function focusExactly(focused: Repo[], allRepos: Repo[]): Promise<void> {
  const focusedIds = new Set(focused.map((r) => `${r.folder.uri.toString()}::${r.relPath}`));
  const byFolder = new Map<string, Repo[]>();
  for (const r of allRepos) {
    const key = r.folder.uri.toString();
    (byFolder.get(key) ?? byFolder.set(key, []).get(key)!).push(r);
  }
  for (const group of byFolder.values()) {
    const folder = group[0].folder;
    const cfg = vscode.workspace.getConfiguration('files', folder.uri);
    const map = { ...(cfg.get<Record<string, boolean>>('exclude') ?? {}) };
    for (const r of group) {
      const id = `${r.folder.uri.toString()}::${r.relPath}`;
      if (focusedIds.has(id)) {
        delete map[r.relPath];
      } else {
        map[r.relPath] = true;
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
  const provider = new RepoProvider(undefined);
  const view = vscode.window.createTreeView('explorerFocus.repos', {
    treeDataProvider: provider,
    canSelectMany: true,
  });

  context.subscriptions.push(
    view,
    view.onDidChangeSelection(async (e) => {
      // Empty selection (clicked empty space) keeps the last focus untouched.
      if (e.selection.length === 0) {
        return;
      }
      const focused = e.selection.map((item) => item.repo);
      await focusExactly(focused, provider.getRepos());
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
      if (e.affectsConfiguration('files.exclude')) {
        provider.refresh();
      }
    })
  );

  // Load the git API asynchronously, then wire repo open/close events.
  void getGitAPI().then((api) => {
    provider.setApi(api);
    if (!api) {
      vscode.window.showWarningMessage(
        'Explorer Focus: the built-in Git extension is not available, so no repositories can be listed.'
      );
      return;
    }
    context.subscriptions.push(
      api.onDidOpenRepository(() => provider.refresh()),
      api.onDidCloseRepository(() => provider.refresh())
    );
    // Start every session with all repos visible, so a stale selection from a
    // previous session never leaves repos hidden out of sync with the view.
    void setAllHidden(provider.getRepos(), false).then(() => provider.refresh());
  });
}

export function deactivate() {}
