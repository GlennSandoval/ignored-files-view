# Repository Guidelines

This document provides concise, actionable guidance for contributing to this repository.
It applies to the entire repo unless a more specific guideline exists deeper in the tree.

## Project Structure & Module Organization
- `src/` – Source code for the plugin (TypeScript/JavaScript preferred).
- `tests/` – Unit/integration tests mirroring `src/` structure.
- `assets/` – Static files (icons, screenshots, sample data).
- `dist/` – Build artifacts (not committed).
- `examples/` – Minimal usage examples or demo project.
Use feature‑oriented folders within `src/` (e.g., `src/core/`, `src/ui/`, `src/adapters/`). Keep files small and focused.

## Build, Test, and Development Commands
Assumed Node.js workflow; adapt as needed.
- `npm install` – Install dependencies.
- `npm run dev` – Local dev with watch/reload.
- `npm run build` – Production build to `dist/` (e.g., `tsc` + bundler).
- `npm test` – Run test suite.
- `npm run lint` / `npm run format` – Lint and auto‑format the code.

## Coding Style & Naming Conventions
- Language: TypeScript preferred; use strict types.
- Indentation: 2 spaces; UTF‑8; LF line endings.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes/types, `kebab-case` for file names (`show-ignored.ts`).
- Exports: prefer named exports; avoid default unless warranted.
- Lint/format: Biome. Run `npm run lint` and `npm run format` before pushing; use `npm run typecheck` for TS types.

## Testing Guidelines
- Framework: Jest or Vitest.
- Test files: colocate as `*.test.ts` adjacent to source or mirror under `tests/`.
- Coverage: aim ≥ 80% lines/branches for changed code.
- Write small, behavior‑focused tests; include boundary cases (e.g., large ignore lists).

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `build:`, `chore:`.
- Keep commits focused; one logical change per commit.
- PRs must include: concise description, rationale, screenshots (if UI), steps to verify, and linked issues (`Closes #123`).
- Pass CI (build, lint, tests) before requesting review.

## Security & Configuration Tips
- Do not commit secrets. Use `.env.local` and add `.env.example` for required keys.
- Verify `.gitignore` covers `dist/`, local env files, and editor artifacts.
- Handle large repositories efficiently; avoid blocking I/O on the main thread.

## Agent‑Specific Instructions
When editing or adding files, follow these conventions and keep changes minimal and focused on the task at hand. If project tooling differs from the Node/TypeScript defaults above, update this file and package scripts accordingly.
