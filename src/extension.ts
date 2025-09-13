/**
 * VS Code extension entry point for the Show Ignored plugin.
 *
 * Provides a tree view listing .gitignored files and folders in the workspace.
 * Supports opening, revealing, copying, and deleting ignored files, with caching and trust checks.
 * Main logic: IgnoredTreeDataProvider, command registration, and file operations.
 */
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import { clearIgnoredListCache, listIgnoredFiles, type ListResult } from './git';

const MAX_ITEMS_FALLBACK = 2000;

/**
 * Activates the extension and registers commands and tree provider.
 * @param context The VS Code extension context.
 */
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
    vscode.commands.registerCommand('show-ignored.reveal', async (item?: FileOrDirItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      await revealFile(item);
    }),
    vscode.commands.registerCommand('show-ignored.copyPath', async (item?: FileOrDirItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      await copyPath(item);
    }),
    vscode.commands.registerCommand('show-ignored.delete', async (item?: FileOrDirItem) => {
      if (!(await ensureTrustedForWrite())) return;
      if (!item) {
        vscode.window.showInformationMessage('Select a file from the Ignored Files view.');
        return;
      }
      await deleteResource(item, provider);
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

/**
 * Deactivates the extension.
 */
export function deactivate() {}

/**
 * Tree data provider for ignored files.
 */
class IgnoredTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private cache = new Map<string, ListResult>();
  private controllers = new Map<string, AbortController>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Refreshes the tree view, clearing caches and debouncing UI updates.
   */
  refresh(): void {
    // Cancel pending scans and clear caches
    for (const c of this.controllers.values()) {
      try { c.abort(); } catch {}
    }
    this.controllers.clear();

    this.cache.clear();
    clearIgnoredListCache();

    // Debounce the UI refresh to coalesce bursts
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire(undefined);
    }, 200);
  }

  /**
   * Returns the tree item for the given element.
   * @param element The tree item element.
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Gets the children for the given tree item element.
   * @param element The parent tree item, or undefined for root.
   */
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

  /**
   * Gets the ignored files for a workspace folder.
   * @param folder The workspace folder.
   */
  async getFilesForFolder(folder: vscode.WorkspaceFolder): Promise<vscode.TreeItem[]> {
    try {
      const result = await this.getOrScan(folder);
      if (!result.files.length) {
        return [new MessageItem('No ignored files')];
      }
      const maxItems = getMaxItems();
      const items = buildChildrenForDir(folder, result.files);
      if (result.truncated) {
        const note = new MessageItem(
          `Showing first ${maxItems} ignored files (capped by setting ignored.maxItems)`
        );
        return [note, ...items];
      }
      return items;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return [new MessageItem(msg)];
    }
  }

  /**
   * Gets or scans for ignored files in a folder, with caching and abort support.
   * @param folder The workspace folder.
   */
  private async getOrScan(folder: vscode.WorkspaceFolder): Promise<ListResult> {
    const key = folder.uri.fsPath;
    if (this.cache.has(key)) return this.cache.get(key) as ListResult;
    // Abort any prior scan for this folder and start a new one
    const prev = this.controllers.get(key);
    if (prev) {
      try { prev.abort(); } catch {}
    }
    const controller = new AbortController();
    this.controllers.set(key, controller);

    const maxItems = getMaxItems();
    const result = await listIgnoredFiles(key, maxItems, controller.signal);
    // If a newer controller was created, ignore storing results
    const current = this.controllers.get(key);
    if (current !== controller) {
      return this.cache.get(key) ?? result;
    }
    this.controllers.delete(key);
    this.cache.set(key, result);
    return result;
  }

  /**
   * Gets the children for a directory within a workspace folder.
   * @param folder The workspace folder.
   * @param dirPath The relative directory path.
   */
  private async getChildrenForDirectory(folder: vscode.WorkspaceFolder, dirPath: string): Promise<vscode.TreeItem[]> {
    const result = await this.getOrScan(folder);
    return buildChildrenForDir(folder, result.files, dirPath);
  }
}

/**
 * Tree item for displaying a message.
 */
class MessageItem extends vscode.TreeItem {
  /**
   * @param message The message to display.
   */
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

/**
 * Tree item representing a workspace folder.
 */
class FolderItem extends vscode.TreeItem {
  /**
   * @param folder The workspace folder.
   */
  constructor(public readonly folder: vscode.WorkspaceFolder) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'folder';
    this.resourceUri = folder.uri;
  }
}

/**
 * Tree item representing a directory.
 */
class DirectoryItem extends vscode.TreeItem {
  /**
   * @param folder The workspace folder.
   * @param dirPath The relative directory path.
   */
  constructor(public readonly folder: vscode.WorkspaceFolder, public readonly dirPath: string) {
    super(dirPath.split(/[\\/]/).pop() || dirPath, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'dir';
    this.resourceUri = vscode.Uri.file(join(folder.uri.fsPath, dirPath));
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

/**
 * Tree item representing a file.
 */
class FileItem extends vscode.TreeItem {
  /**
   * @param folder The workspace folder.
   * @param relativePath The file's relative path.
   */
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

type FileOrDirItem = FileItem | DirectoryItem | FolderItem;

/**
 * Opens a file in the appropriate VS Code editor.
 * @param item The file item to open.
 */
async function openFile(item: FileItem) {
  try {
    // Use the generic open command so VS Code picks the right editor
    // (text editor, image viewer, custom editors, etc.).
    const uri = item.resourceUri;
    if (!uri) {
      vscode.window.showWarningMessage('This item has no resource to open.');
      return;
    }
    await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const choice = await vscode.window.showErrorMessage(
      `Cannot open this file in VS Code: ${msg}`,
      'Open Externally',
      'Reveal in Explorer'
    );
    if (choice === 'Open Externally') {
      const uri = item.resourceUri;
      if (uri) await vscode.env.openExternal(uri);
    } else if (choice === 'Reveal in Explorer') {
      const uri = item.resourceUri;
      if (uri) await vscode.commands.executeCommand('revealInExplorer', uri);
    }
  }
}

/**
 * Reveals a file or directory in the VS Code explorer.
 * @param item The file or directory item.
 */
async function revealFile(item: FileOrDirItem) {
  if (!item.resourceUri) return;
  await vscode.commands.executeCommand('revealInExplorer', item.resourceUri);
}

/**
 * Copies the file or directory path to the clipboard.
 * @param item The file or directory item.
 */
async function copyPath(item: FileOrDirItem) {
  const fsPath = item.resourceUri?.fsPath;
  if (fsPath) {
    await vscode.env.clipboard.writeText(fsPath);
    vscode.window.showInformationMessage('Path copied to clipboard');
  }
}

/**
 * Ensures the workspace is trusted before performing write actions.
 * @returns True if trusted, false otherwise.
 */
async function ensureTrustedForWrite(): Promise<boolean> {
  const trustEnabled = vscode.workspace.getConfiguration('security').get<boolean>('workspace.trust.enabled');
  if (trustEnabled && vscode.workspace.isTrusted === false) {
    vscode.window.showWarningMessage('This action is disabled in untrusted workspaces.');
    return false;
  }
  return true;
}

/**
 * Gets the maximum number of items to display, clamped to sane bounds.
 * @returns The maximum number of items.
 */
function getMaxItems(): number {
  const cfg = vscode.workspace.getConfiguration('ignored');
  // Read contributed default via inspect when available (single source of truth).
  const inspected = (cfg as any).inspect?.('maxItems') as { defaultValue?: number } | undefined;
  const contributedDefault = typeof inspected?.defaultValue === 'number' ? inspected.defaultValue : MAX_ITEMS_FALLBACK;
  let n = cfg.get<number>('maxItems', contributedDefault);
  // Clamp to sane bounds
  if (!Number.isFinite(n) || n <= 0) n = contributedDefault;
  if (n > MAX_ITEMS_FALLBACK) n = MAX_ITEMS_FALLBACK;
  return Math.floor(n);
}

/**
 * Builds tree items for a directory, including subdirectories and files.
 * @param folder The workspace folder.
 * @param allFiles All ignored file paths.
 * @param dirPath The relative directory path (optional).
 * @returns Array of tree items for the directory.
 */
function buildChildrenForDir(
  folder: vscode.WorkspaceFolder,
  allFiles: string[],
  dirPath?: string
): vscode.TreeItem[] {
  const prefix = dirPath ? `${dirPath.replace(/[\\/]+$/, '')}/` : '';
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

/**
 * Deletes a file or directory, moving it to the OS trash.
 * @param item The file or directory item to delete.
 * @param provider The tree data provider (for refresh).
 */
async function deleteResource(item: FileOrDirItem, provider: IgnoredTreeDataProvider) {
  const uri = item.resourceUri;
  if (!uri) return;
  const name = basename(uri.fsPath);
  const choice = await vscode.window.showWarningMessage(
    `Delete '${name}'? This moves the ${item instanceof DirectoryItem ? 'folder' : 'file'} to the OS trash.`,
    { modal: true },
    'Delete'
  );
  if (choice !== 'Delete') return;

  try {
    await vscode.workspace.fs.delete(uri, { useTrash: true, recursive: item instanceof DirectoryItem });
    vscode.window.showInformationMessage(`Deleted '${name}'`);
    provider.refresh();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to delete '${name}': ${msg}`);
  }
}
