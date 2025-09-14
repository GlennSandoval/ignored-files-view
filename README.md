# Show Ignored Files (VS Code Extension)

A Visual Studio Code extension that provides a tree view listing all files ignored by Git in the current workspace.

## Features

- Explorer view: "Ignored Files" (`ignoredFilesView`).
- Single- and multi-root workspace support.
- Copy full path; delete file (to OS trash).
- Show ignore rule: reveal which `.gitignore` pattern and line ignores a file.
- Manual refresh; respects Workspace Trust.
- Efficient scanning with result capping via a setting.

## Commands

- `Ignored Files: Refresh` (`show-ignored.refresh`)

## Settings

- `ignoredFilesView.maxItems` (number, default: 2000): Maximum number of ignored files to collect and display. Capped to protect performance on very large repos. Values are clamped to a safe range.
 - `ignoredFilesView.excludeFolders` (string[], default: ["node_modules"]): Folder names to exclude from the Ignored Files view. Matches any path segment. Remove `node_modules` from this list to include it.

## Requirements

- Git must be available on your PATH.
- Open a folder that is a Git repository (or a multi-root workspace with Git repos).

## Activation

- Activates when the "Ignored Files" view is revealed or when a workspace contains a `.git` directory.

## Usage

1. Open the Explorer view in VS Code.
2. Locate the "Ignored Files" tree. In multi-root workspaces, expand a root first.
3. Use the inline actions or the Command Palette entries listed above.

## Development

- `npm install` – Install dependencies.
- `npm run dev` – Build with Vite in watch mode to `dist/`.
- Lint: `npm run lint` (Biome) and `npm run typecheck` (TypeScript no-emit).
- Format: `npm run format` (Biome, writes changes).
- Run/Debug: Press F5 in VS Code to start an Extension Development Host. The pre-launch task performs a one-off `npm run build`. For hot rebuilds, keep `npm run dev` running in a terminal.
- Tests: `npm test` (builds then runs unit and smoke tests).
- Package: `npm run package` (requires `vsce` installed globally).

This repo uses Biome for linting and formatting. See `biome.json` for configuration. VS Code users get formatter defaults via `.vscode/settings.json`; the Biome extension (`biomejs.biome`) is recommended.

## Notes

- Discovery uses `git ls-files --others -i --exclude-standard -z` under the workspace folder(s).
- If the workspace is untrusted and Workspace Trust is enabled, listing and write actions are disabled.
- Delete moves files to the OS trash (no permanent deletes).
 - Built with Vite; extension entry is bundled to `dist/extension.js`.
