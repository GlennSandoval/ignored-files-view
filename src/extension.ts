/**
 * VS Code extension entry point for the Show Ignored plugin.
 *
 * Provides a tree view listing .gitignored files and folders in the workspace.
 * Supports opening, revealing, copying, and deleting ignored files, with caching and trust checks.
 * Main logic: IgnoredTreeDataProvider, command registration, and file operations.
 */
import { basename } from "node:path";
import * as vscode from "vscode";
import {
  DirectoryItem,
  type FileItem,
  type FileOrDirItem,
  IgnoredTreeDataProvider,
} from "./ignored-tree-data-provider";

// moved to ignored-tree-data-provider.ts

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
