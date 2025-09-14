/**
 * VS Code extension entry point for the Show Ignored plugin.
 *
 * Provides a tree view listing .gitignored files and folders in the workspace.
 * Supports opening, revealing, copying, and deleting ignored files, with caching and trust checks.
 * Main logic: IgnoredTreeDataProvider, command registration, and file operations.
 */
import { basename, join } from "node:path";
import * as vscode from "vscode";
import { type ListResult, clearIgnoredListCache, listIgnoredFiles } from "./git";

const MAX_ITEMS_FALLBACK = 2000;
const MAX_ITEMS_UPPER_BOUND = 20000;

/**
 * Activates the extension and registers commands and tree provider.
 * @param context The VS Code extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new IgnoredTreeDataProvider();
  let configChangeRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  // Helper to require an item, otherwise show info message
  function requireItem<T>(cb: (item: T) => Promise<void>): (item?: T) => Promise<void> {
    return async (item?: T) => {
      if (!item) {
        vscode.window.showInformationMessage("Select a file from the Ignored Files view.");
        return;
      }
      await cb(item);
    };
  }

  context.subscriptions.push(
    vscode.window.createTreeView("ignoredFilesView", {
      treeDataProvider: provider,
    }),
    vscode.commands.registerCommand("show-ignored.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("show-ignored.open", requireItem(openFile)),
    vscode.commands.registerCommand("show-ignored.copyPath", requireItem(copyPath)),
    vscode.commands.registerCommand(
      "show-ignored.delete",
      requireItem(async (item: FileOrDirItem) => {
        if (!(await ensureTrustedForWrite())) return;
        await deleteResource(item, provider);
      }),
    ),
  );

  // Apply updated settings immediately (e.g., ignored.maxItems)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ignored.maxItems")) {
        if (configChangeRefreshTimer) clearTimeout(configChangeRefreshTimer);
        configChangeRefreshTimer = setTimeout(() => {
          configChangeRefreshTimer = undefined;
          provider.refresh();
        }, 1500);
      }
    }),
  );
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {}

/**
 * Tree data provider for ignored files.
 */
class IgnoredTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;
  private folderCache = new Map<string, ListResult>();
  private scanControllers = new Map<string, AbortController>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Refreshes the tree view, clearing caches and debouncing UI updates.
   */
  refresh(): void {
    // Cancel pending scans and clear caches
    for (const controller of this.scanControllers.values()) {
      try {
        controller.abort();
      } catch {}
    }
    this.scanControllers.clear();

    this.folderCache.clear();
    clearIgnoredListCache();

    // Debounce the UI refresh to coalesce bursts
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this._onDidChangeTreeDataEmitter.fire(undefined);
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
    const trust = await vscode.workspace
      .getConfiguration("security")
      .get<boolean>("workspace.trust.enabled");
    if (trust && vscode.workspace.isTrusted === false) {
      return [new MessageItem("Workspace is untrusted — listing disabled")];
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      return [new MessageItem("Open a folder inside a Git repository")];
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
        return [new MessageItem("No ignored files")];
      }
      const maxItems = getMaxItems();
      const items = buildChildrenForDir(folder, result.files);
      if (result.truncated) {
        const note = new MessageItem(
          `Showing first ${maxItems} ignored files (capped by setting ignored.maxItems)`,
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
    const folderPath = folder.uri.fsPath;
    if (this.folderCache.has(folderPath)) return this.folderCache.get(folderPath) as ListResult;
    // Abort any prior scan for this folder and start a new one
    const previousController = this.scanControllers.get(folderPath);
    if (previousController) {
      try {
        previousController.abort();
      } catch {}
    }
    const abortController = new AbortController();
    this.scanControllers.set(folderPath, abortController);

    const maxItems = getMaxItems();
    const result = await listIgnoredFiles(folderPath, maxItems, abortController.signal);
    // If a newer controller was created, ignore storing results
    const currentController = this.scanControllers.get(folderPath);
    if (currentController !== abortController) {
      return this.folderCache.get(folderPath) ?? result;
    }
    this.scanControllers.delete(folderPath);
    this.folderCache.set(folderPath, result);
    return result;
  }

  /**
   * Gets the children for a directory within a workspace folder.
   * @param folder The workspace folder.
   * @param dirPath The relative directory path.
   */
  private async getChildrenForDirectory(
    folder: vscode.WorkspaceFolder,
    dirPath: string,
  ): Promise<vscode.TreeItem[]> {
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
    this.contextValue = "message";
    this.iconPath = new vscode.ThemeIcon("info");
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
    this.contextValue = "folder";
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
  constructor(
    public readonly folder: vscode.WorkspaceFolder,
    public readonly dirPath: string,
  ) {
    super(dirPath.split(/[\\/]/).pop() || dirPath, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "dir";
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
  constructor(
    public readonly folder: vscode.WorkspaceFolder,
    public readonly relativePath: string,
  ) {
    super(relativePath.split(/[\\/]/).pop() || relativePath, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "file";
    this.resourceUri = vscode.Uri.file(join(folder.uri.fsPath, relativePath));
    this.iconPath = vscode.ThemeIcon.File;
  }
}

/**
 * Represents any item in the ignored files tree that can be a file, directory, or folder.
 */
type FileOrDirItem = FileItem | DirectoryItem | FolderItem;

/**
 * Opens a file in the appropriate VS Code editor.
 * @param item The file item to open.
 */
async function openFile(item: FileItem): Promise<void> {
  try {
    // Use the generic open command so VS Code picks the right editor
    // (text editor, image viewer, custom editors, etc.).
    const uri = item.resourceUri;
    if (!uri) {
      vscode.window.showWarningMessage("This item has no resource to open.");
      return;
    }
    await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const choice = await vscode.window.showErrorMessage(
      `Cannot open this file in VS Code: ${msg}`,
      "Open Externally",
      "Reveal in Explorer",
    );
    if (choice === "Open Externally") {
      const uri = item.resourceUri;
      if (uri) await vscode.env.openExternal(uri);
    } else if (choice === "Reveal in Explorer") {
      const uri = item.resourceUri;
      if (uri) await vscode.commands.executeCommand("revealInExplorer", uri);
    }
  }
}

/**
 * Copies the file or directory path to the clipboard.
 * @param item The file or directory item.
 */
async function copyPath(item: FileOrDirItem): Promise<void> {
  const fsPath = item.resourceUri?.fsPath;
  if (fsPath) {
    await vscode.env.clipboard.writeText(fsPath);
    vscode.window.showInformationMessage("Path copied to clipboard");
  }
}

/**
 * Ensures the workspace is trusted before performing write actions.
 * @returns True if trusted, false otherwise.
 */
async function ensureTrustedForWrite(): Promise<boolean> {
  const trustEnabled = vscode.workspace
    .getConfiguration("security")
    .get<boolean>("workspace.trust.enabled");
  if (trustEnabled && vscode.workspace.isTrusted === false) {
    vscode.window.showWarningMessage("This action is disabled in untrusted workspaces.");
    return false;
  }
  return true;
}

/**
 * Gets the maximum number of items to display, clamped to sane bounds.
 * @returns The maximum number of items.
 */
function getMaxItems(): number {
  const cfg = vscode.workspace.getConfiguration("ignored");
  const inspected = cfg.inspect("maxItems");
  const effectiveDefault =
    typeof inspected?.defaultValue === "number" ? inspected.defaultValue : MAX_ITEMS_FALLBACK;
  let maxItemsCount = cfg.get<number>("maxItems", effectiveDefault);
  // Clamp to sane bounds
  if (!Number.isFinite(maxItemsCount) || maxItemsCount <= 0) maxItemsCount = effectiveDefault;
  maxItemsCount = Math.min(maxItemsCount, MAX_ITEMS_UPPER_BOUND);
  return Math.floor(maxItemsCount);
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
  dirPath?: string,
): vscode.TreeItem[] {
  const prefix = dirPath ? `${dirPath.replace(/[\/]+$/, "")}/` : "";
  const subdirectoryNames = new Set<string>();
  const filePaths: string[] = [];

  for (const relativePath of allFiles) {
    if (!relativePath.startsWith(prefix)) continue;
    const restOfPath = relativePath.slice(prefix.length);
    if (!restOfPath) continue;
    const firstSlashIndex = restOfPath.indexOf("/");
    if (firstSlashIndex === -1) {
      filePaths.push(relativePath); // file directly under this directory
    } else {
      subdirectoryNames.add(restOfPath.slice(0, firstSlashIndex));
    }
  }

  const directoryItems = Array.from(subdirectoryNames)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((subdirName) => new DirectoryItem(folder, prefix + subdirName));

  const fileItems = filePaths
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((relativePath) => new FileItem(folder, relativePath));

  return [...directoryItems, ...fileItems];
}

/**
 * Deletes a file or directory, moving it to the OS trash.
 * @param item The file or directory item to delete.
 * @param provider The tree data provider (for refresh).
 */
async function deleteResource(
  item: FileOrDirItem,
  provider: IgnoredTreeDataProvider,
): Promise<void> {
  const uri = item.resourceUri;
  if (!uri) return;
  const name = basename(uri.fsPath);
  const choice = await vscode.window.showWarningMessage(
    `Delete '${name}'? This moves the ${item instanceof DirectoryItem ? "folder" : "file"} to the OS trash.`,
    { modal: true },
    "Delete",
  );
  if (choice !== "Delete") return;

  try {
    await vscode.workspace.fs.delete(uri, {
      useTrash: true,
      recursive: item instanceof DirectoryItem,
    });
    vscode.window.showInformationMessage(`Deleted '${name}'`);
    provider.refresh();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to delete '${name}': ${msg}`);
  }
}
