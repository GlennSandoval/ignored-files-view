# Show Ignored Files (VS Code Extension)

A Visual Studio Code extension that provides a tree view listing all files ignored by Git in the current workspace.

## Features

- Explorer view: "Ignored Files" (`ignoredFilesView`).
- Single- and multi-root workspace support.
- Click to open file; reveal in Explorer.
- Copy full path; delete file (to OS trash).
- Manual refresh; respects Workspace Trust.
- Efficient scanning with result capping via a setting.

## Commands

- `Ignored Files: Refresh` (`show-ignored.refresh`)
- `Ignored Files: Open` (`show-ignored.open`)
- `Ignored Files: Reveal in Explorer` (`show-ignored.reveal`)
- `Ignored Files: Copy Path` (`show-ignored.copyPath`)
- `Ignored Files: Delete` (`show-ignored.delete`)
- `Ignored Files: Unignore (stub)` (`show-ignored.unignore`)

## Settings

- `ignored.maxItems` (number, default: 2000): Maximum number of ignored files to collect and display. Capped to protect performance on very large repos. Values are clamped to a safe range.

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
- `npm run watch` – Compile TypeScript in watch mode to `out/`.
- Run/Debug: Press F5 in VS Code to start an Extension Development Host.
- Tests: `npm test` (builds then runs unit and smoke tests).
- Package: `npm run package` (requires `vsce` installed globally).

## Notes

- Discovery uses `git ls-files --others -i --exclude-standard -z` under the workspace folder(s).
- If the workspace is untrusted and Workspace Trust is enabled, listing and write actions are disabled.
- Delete moves files to the OS trash (no permanent deletes).
