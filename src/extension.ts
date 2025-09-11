import * as vscode from 'vscode';
import { join } from 'node:path';
import { listIgnoredFiles } from './git';

export function activate(context: vscode.ExtensionContext) {
  const provider = new IgnoredTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ignoredFilesView', provider),
    vscode.commands.registerCommand('show-ignored.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('show-ignored.open', async (item?: FileItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      await openFile(item);
    }),
    vscode.commands.registerCommand('show-ignored.reveal', async (item?: FileItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      await revealFile(item);
    }),
    vscode.commands.registerCommand('show-ignored.delete', async (item?: FileItem) => {
      if (!(await ensureTrustedForWrite())) return;
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      vscode.window.showInformationMessage('Delete action is not implemented yet.');
    }),
    vscode.commands.registerCommand('show-ignored.unignore', async (item?: FileItem) => {
      if (!(await ensureTrustedForWrite())) return;
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      vscode.window.showInformationMessage('Unignore action is not implemented yet.');
    })
  );
}

export function deactivate() {}

class IgnoredTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache = new Map<string, string[]>();

  refresh(): void {
    this.cache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
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
        // Single-root: show directory tree for that folder
        return this.getFilesForFolder(folders[0]);
      }
      // Multi-root: show root headers
      return folders.map((f) => new FolderItem(f));
    }

    if (element instanceof FolderItem) {
      return this.getFilesForFolder(element.folder);
    }

    if (element instanceof DirectoryItem) {
      return this.getChildrenForDirectory(element.folder, element.dirPath);
    }

    return [];
  }

  async getFilesForFolder(folder: vscode.WorkspaceFolder): Promise<vscode.TreeItem[]> {
    try {
      const files = await this.getOrScan(folder);
      if (!files.length) {
        return [new MessageItem('No ignored files')];
      }
      return buildChildrenForDir(folder, files);
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : String(err);
      return [new MessageItem(msg)];
    }
  }

  private async getOrScan(folder: vscode.WorkspaceFolder): Promise<string[]> {
    const key = folder.uri.fsPath;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const files = await listIgnoredFiles(key);
    this.cache.set(key, files);
    return files;
  }

  private async getChildrenForDirectory(folder: vscode.WorkspaceFolder, dirPath: string): Promise<vscode.TreeItem[]> {
    const files = await this.getOrScan(folder);
    return buildChildrenForDir(folder, files, dirPath);
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

class DirectoryItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder, public readonly dirPath: string) {
    super(dirPath.split(/[\\/]/).pop() || dirPath, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'dir';
    this.resourceUri = vscode.Uri.file(join(folder.uri.fsPath, dirPath));
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder, public readonly relativePath: string) {
    super(relativePath.split(/[\\/]/).pop() || relativePath, vscode.TreeItemCollapsibleState.None);
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


async function openFile(item: FileItem) {
  const doc = await vscode.workspace.openTextDocument(item.resourceUri!);
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function revealFile(item: FileItem) {
  await vscode.commands.executeCommand('revealInExplorer', item.resourceUri!);
}

async function ensureTrustedForWrite(): Promise<boolean> {
  const trustEnabled = vscode.workspace.getConfiguration('security').get<boolean>('workspace.trust.enabled');
  if (trustEnabled && vscode.workspace.isTrusted === false) {
    vscode.window.showWarningMessage('This action is disabled in untrusted workspaces.');
    return false;
  }
  return true;
}

function buildChildrenForDir(
  folder: vscode.WorkspaceFolder,
  allFiles: string[],
  dirPath?: string
): vscode.TreeItem[] {
  const prefix = dirPath ? dirPath.replace(/[\\/]+$/, '') + '/' : '';
  const subdirs = new Set<string>();
  const files: string[] = [];

  for (const rel of allFiles) {
    if (!rel.startsWith(prefix)) continue;
    const rest = rel.slice(prefix.length);
    if (!rest) continue;
    const idx = rest.indexOf('/');
    if (idx === -1) {
      files.push(rel); // file directly under this directory
    } else {
      subdirs.add(rest.slice(0, idx));
    }
  }

  const dirItems = Array.from(subdirs)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((name) => new DirectoryItem(folder, prefix + name));

  const fileItems = files
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((rel) => new FileItem(folder, rel));

  return [...dirItems, ...fileItems];
}
