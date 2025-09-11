# Project Plan — VS Code Extension: Show Ignored Files

## Objective
Provide a fast, reliable tree view in Visual Studio Code that lists all files ignored by Git for the current workspace (multi-root supported), with convenient actions to inspect, open, unignore, or manage them.

## Scope & Users
- Users: Developers working in Git repositories who need visibility into ignored artifacts.
- In-scope: Read-only discovery of ignored files; common actions (open, reveal, copy path, delete, unignore); multi-root; workspace trust; performance on large repos.
- Out-of-scope (v1): Non-Git VCS, advanced diff/preview, remote editing of global ignore files beyond simple append.

## Architecture Overview
- Activation: `onStartupFinished`, `onView:ignoredFilesView`, `workspaceContains:.git`. Respect Workspace Trust (disable scanning if untrusted).
- Discovery: Prefer Git CLI `git ls-files --others -i --exclude-standard -z` per workspace folder. Fallback to parsing `.gitignore` with the `ignore` package if Git CLI unavailable.
- Components:
  - `GitFacade`: Executes Git commands with timeouts, cancellation, and error mapping.
  - `IgnoredScanner`: Scans per root, caches results, debounced refresh on FS and `.gitignore` changes.
  - `IgnoredTreeDataProvider`: Builds tree nodes (folder grouping) with incremental loading.
  - Commands: `ignored.open`, `ignored.reveal`, `ignored.copyPath`, `ignored.delete`, `ignored.unignore`, `ignored.refresh`.
- Performance: Stream/process `-z` output, cap results (`ignored.maxItems`), support cancellation tokens, avoid scanning node_modules unless needed (Git handles this).

## Features (v1)
- Tree View: “Ignored Files” in Explorer container with root grouping; filter input (`ignored.filter`), sort by name/path.
- Actions: Open (preview), Reveal in Explorer, Copy Path, Delete (confirm), Unignore (append pattern to nearest `.gitignore`), Open `.gitignore`.
- Multi-root: Independent scans per folder, unified view with root headers.
- Settings:
  - `ignored.showDirectoriesOnly` (bool)
  - `ignored.includeGlobalIgnores` (bool, via Git default)
  - `ignored.maxItems` (number)
  - `ignored.scanMode` (`git` | `fallback` | `auto`)
  - `ignored.autoRefresh` (bool)

## Milestones & Acceptance Criteria
1) M0 — Scaffold & CI (0.5d)
- TypeScript project, esbuild bundling, basic activation, GitHub Actions for build/lint/test.

2) M1 — Ignored Discovery (1–2d)
- Single-root: returns list via Git CLI; reasonable errors if not a repo; unit tests for parser.

3) M2 — Tree View UI (1d)
- TreeDataProvider with folder grouping, refresh button, empty states; smoke tests.

4) M3 — Actions (1–1.5d)
- Open, Reveal, Copy Path, Delete (with confirmation), Unignore (append + reload). Tests for unignore logic.

5) M4 — Multi-root & Trust (0.5–1d)
- Handles multiple folders; disables features when workspace untrusted.

6) M5 — Performance & Polish (1d)
- Caching, debounced refresh, cancellation, result caps, telemetry off by default.

7) M6 — Docs & Release (0.5d)
- README, commands/settings docs, icons, changelog, `vsce` packaging.

## Development & Commands
- `npm install`
- `npm run watch` — Compile with esbuild/tsup.
- `npm run lint` / `npm run format` — ESLint/Prettier.
- `npm test` — Unit tests with Vitest/Jest.
- `npm run test:integration` — `@vscode/test-electron` run.
- `npm run package` — Bundle with `vsce`.

## Testing Strategy
- Unit: Git output parsing, unignore rule placement, path normalization, config handling.
- Integration: Launch VS Code, open sample repos, validate tree content and commands.
- Coverage: ≥80% for changed code. CI runs unit + minimal integration matrix (macOS/Linux/Windows).

## Risks & Mitigations
- Large repos: use streaming, caps, cancellation; avoid full FS scans.
- Absent Git: fallback mode with warning; degrade gracefully.
- Workspace trust: block file writes (unignore/delete) when untrusted; read-only listing optional.

## Success Metrics
- Time to first list < 500ms on typical repos.
- No blocking UI; low memory footprint.
- Positive user feedback; minimal error reports.

## Milestone Tracker
Track completion using checkboxes below. Run `npm run milestones` to print progress per milestone and overall.

### M0 — Scaffold & CI
- [x] TypeScript project scaffolded
- [x] Build configured (tsc/bundler)
- [x] CI workflow for build/lint/test

### M1 — Ignored Discovery
- [x] Single-root discovery via Git CLI returns list
- [x] Graceful errors when not a Git repo
- [ ] Unit tests for Git output parser

### M2 — Tree View UI
- [x] TreeDataProvider with folder grouping
- [ ] Refresh button and empty states
- [ ] Smoke tests for the view

### M3 — Actions
- [ ] Open, Reveal, Copy Path actions
- [ ] Delete with confirmation
- [ ] Unignore (append pattern) + reload
- [ ] Tests for unignore logic

### M4 — Multi-root & Trust
- [x] Multi-root workspace support
- [ ] Workspace trust gating for write actions

### M5 — Performance & Polish
- [ ] Caching of results
- [ ] Debounced refresh and cancellation
- [ ] Result caps; telemetry off by default

### M6 — Docs & Release
- [ ] README and command/setting docs
- [ ] Icons and changelog
- [ ] `vsce` packaging ready
