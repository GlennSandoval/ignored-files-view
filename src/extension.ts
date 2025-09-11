import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export function activate(context: vscode.ExtensionContext) {
  const provider = new IgnoredTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ignoredFilesView', provider),
    vscode.commands.registerCommand('show-ignored.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('show-ignored.open', (item: FileItem) => openFile(item)),
    vscode.commands.registerCommand('show-ignored.reveal', (item: FileItem) => revealFile(item))
  );
}

export function deactivate() {}

class IgnoredTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const trust = await vscode.workspace.getConfiguration('security').get<boolean>('workspace.trust.enabled');
    if (trust && vscode.workspace.isTrusted === false) {
      return [new MessageItem('Workspace is untrusted — listing disabled')];
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      return [new MessageItem('Open a folder inside a Git repository')];
    }

    if (!element) {
      if (folders.length === 1) {
        // Show files directly for single-root workspaces
        return this.getFilesForFolder(folders[0]);
      }
      // Multi-root: show root headers
      return folders.map((f) => new FolderItem(f));
    }

    if (element instanceof FolderItem) {
      return this.getFilesForFolder(element.folder);
    }

    return [];
  }

  async getFilesForFolder(folder: vscode.WorkspaceFolder): Promise<vscode.TreeItem[]> {
    try {
      const files = await listIgnoredFiles(folder.uri.fsPath);
      if (!files.length) {
        return [new MessageItem('No ignored files')];
      }
      return files.map((rel) => new FileItem(folder, rel));
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : String(err);
      return [new MessageItem(msg)];
    }
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class FolderItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'folder';
    this.resourceUri = folder.uri;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder, public readonly relativePath: string) {
    super(relativePath, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'file';
    this.resourceUri = vscode.Uri.file(join(folder.uri.fsPath, relativePath));
    this.command = {
      command: 'show-ignored.open',
      title: 'Open File',
      arguments: [this]
    };
    this.iconPath = vscode.ThemeIcon.File;
  }
}

async function listIgnoredFiles(cwd: string): Promise<string[]> {
  // Use git CLI for accurate results, zero-delimited to avoid parsing issues
  const args = ['ls-files', '--others', '-i', '--exclude-standard', '-z'];
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    const parts = stdout.split('\u0000').filter(Boolean);
    return parts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch (e: any) {
    if (typeof e?.stderr === 'string' && e.stderr.includes('fatal')) {
      throw new Error('Not a Git repository or Git unavailable');
    }
    throw e;
  }
}

async function openFile(item: FileItem) {
  const doc = await vscode.workspace.openTextDocument(item.resourceUri);
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function revealFile(item: FileItem) {
  await vscode.commands.executeCommand('revealInExplorer', item.resourceUri);
}

