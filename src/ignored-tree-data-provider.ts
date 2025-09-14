/**
 * Tree provider and helpers for the "Ignored Files" view.
 *
 * Scans workspace folders for files ignored by Git and presents a
 * navigable tree grouped by folders. Includes basic caching, trust
 * checks, and utilities for building file and directory items.
 */
import { join } from "node:path";
import * as vscode from "vscode";
import { type ListResult, clearIgnoredListCache, listIgnoredFiles } from "./git";

/** Default max items used if configuration is missing or invalid. */
const MAX_ITEMS_FALLBACK = 2000;
/** Upper hard cap to protect performance on very large repos. */
const MAX_ITEMS_UPPER_BOUND = 20000;

/**
 * Provides tree data for the Ignored Files view.
 *
 * Caches per-folder results and debounces refresh events. Honors
 * VS Code workspace trust to avoid scanning untrusted workspaces.
 */
export class IgnoredTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  /** Event fired when the tree should refresh. */
  readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;
  private folderCache = new Map<string, ListResult>();
  private scanControllers = new Map<string, AbortController>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Refreshes the tree by clearing caches and notifying listeners.
   * Aborts any in-flight scans and debounces the UI update.
   */
  refresh(): void {
    for (const controller of this.scanControllers.values()) {
      try {
        controller.abort();
      } catch {}
    }
    this.scanControllers.clear();

    this.folderCache.clear();
    clearIgnoredListCache();

    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this._onDidChangeTreeDataEmitter.fire(undefined);
    }, 200);
  }

  /**
   * Returns the given element. Required by the TreeDataProvider API.
   * @param element The tree item element.
   * @returns The same element.
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Provides children for the given element or root.
   * - At root: shows either a single folder's files or a list of folders
   *   when in multi-root workspaces.
   * - For a folder: returns its ignored files grouped by directories.
   * - For a directory: returns its subdirectories and files.
   * @param element Optional parent tree item.
   * @returns Child tree items for the element.
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
        return this.getFilesForFolder(folders[0]);
      }
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
   * Gets ignored items for a specific workspace folder.
   * @param folder The workspace folder.
   * @returns Message items or directory/file items for the folder.
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
   * Returns cached scan results or performs a new scan for a folder.
   * Handles cancelation of previous scans and stores results in-memory.
   * @param folder The workspace folder to scan.
   * @returns The list of ignored files for the folder.
   */
  private async getOrScan(folder: vscode.WorkspaceFolder): Promise<ListResult> {
    const folderPath = folder.uri.fsPath;
    if (this.folderCache.has(folderPath)) return this.folderCache.get(folderPath) as ListResult;
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
    const currentController = this.scanControllers.get(folderPath);
    if (currentController !== abortController) {
      return this.folderCache.get(folderPath) ?? result;
    }
    this.scanControllers.delete(folderPath);
    this.folderCache.set(folderPath, result);
    return result;
  }

  /**
   * Gets the children for a subdirectory within a folder from cached results.
   * @param folder The workspace folder.
   * @param dirPath The directory path relative to the folder root.
   * @returns Child tree items (subdirectories and files).
   */
  private async getChildrenForDirectory(
    folder: vscode.WorkspaceFolder,
    dirPath: string,
  ): Promise<vscode.TreeItem[]> {
    const result = await this.getOrScan(folder);
    return buildChildrenForDir(folder, result.files, dirPath);
  }
}

/** Simple tree item for displaying informational messages in the view. */
class MessageItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "message";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

/**
 * Tree item representing a workspace folder in multi-root workspaces.
 */
export class FolderItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "folder";
    this.resourceUri = folder.uri;
  }
}

/**
 * Tree item representing a directory within a workspace folder.
 */
export class DirectoryItem extends vscode.TreeItem {
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
 * Tree item representing a file within a workspace folder.
 */
export class FileItem extends vscode.TreeItem {
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
 * Union type for all tree items the view commands accept.
 */
export type FileOrDirItem = FileItem | DirectoryItem | FolderItem;

/**
 * Reads the configured maximum number of items to display and clamps it
 * to sensible bounds to prevent unbounded scans on huge repositories.
 * @returns Effective max item count.
 */
function getMaxItems(): number {
  const cfg = vscode.workspace.getConfiguration("ignored");
  const inspected = cfg.inspect?.("maxItems");
  const effectiveDefault =
    typeof inspected?.defaultValue === "number" ? inspected.defaultValue : MAX_ITEMS_FALLBACK;
  let maxItemsCount = cfg.get<number>("maxItems", effectiveDefault);
  if (!Number.isFinite(maxItemsCount) || maxItemsCount <= 0) maxItemsCount = effectiveDefault;
  maxItemsCount = Math.min(maxItemsCount, MAX_ITEMS_UPPER_BOUND);
  return Math.floor(maxItemsCount);
}

/**
 * Builds child items for a directory, grouping results into subdirectories
 * and files, and sorting them case-insensitively for a stable UI.
 * @param folder The workspace folder for which items are built.
 * @param allFiles All ignored file paths (relative to the folder root).
 * @param dirPath Optional directory path relative to the folder root.
 * @returns Ordered list of directory and file items.
 */
function buildChildrenForDir(
  folder: vscode.WorkspaceFolder,
  allFiles: string[],
  dirPath?: string,
): vscode.TreeItem[] {
  const prefix = dirPath ? `${dirPath.replace(/[\\/]+$/, "")}/` : "";
  const subdirectoryNames = new Set<string>();
  const filePaths: string[] = [];

  for (const relativePath of allFiles) {
    if (!relativePath.startsWith(prefix)) continue;
    const restOfPath = relativePath.slice(prefix.length);
    if (!restOfPath) continue;
    const firstSlashIndex = restOfPath.indexOf("/");
    if (firstSlashIndex === -1) {
      filePaths.push(relativePath);
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
