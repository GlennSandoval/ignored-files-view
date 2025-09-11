# Show Ignored Files (VS Code Extension)

A Visual Studio Code extension that provides a tree view listing all files ignored by Git in the current workspace.

## Features
- Explorer view "Ignored Files"
- Supports single and multi-root workspaces
- Open file and reveal in Explorer
- Manual refresh command

## Commands
- `Ignored Files: Refresh` (`show-ignored.refresh`)
- `Ignored Files: Open` (`show-ignored.open`)
- `Ignored Files: Reveal in Explorer` (`show-ignored.reveal`)

## Activation
- Opens when you focus the "Ignored Files" view
- Also activates in Git repositories

## Development
- `npm install`
- `npm run watch` to compile TypeScript
- Press F5 in VS Code to launch an Extension Development Host

## Notes
- Discovery uses `git ls-files --others -i --exclude-standard -z`.
- If the workspace is untrusted, listing is disabled.
