import { Uri, Event } from 'vscode';

/**
 * Minimal subset of the built-in Git extension API (vscode.git).
 * Only the members this extension uses are declared.
 * Full definition: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */

export interface Repository {
  readonly rootUri: Uri;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}
