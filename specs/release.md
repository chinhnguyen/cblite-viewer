# Release Workflow

## Purpose

Document how to build, package, install, and verify the extension locally.

## Prerequisites

- Node.js and npm are installed.
- Cursor CLI is available as `cursor`.
- Dependencies are installed with `npm install`.

## Build

```shell
npm run compile
```

Expected:

- TypeScript compiles into `out/`.
- No TypeScript errors are emitted.

## Package

```shell
npm run package
```

Expected:

- `cblite-vscode-0.0.1.vsix` is generated.
- The package includes compiled files from `out/`, `README.md`, `LICENSE`, `resources/database.svg`, `package.json`, and runtime dependencies.
- The current known warning is missing `repository` in `package.json`.

## Local Install In Cursor

```shell
cursor --install-extension "cblite-vscode-0.0.1.vsix" --force
```

Then reload the extension host:

```text
Command Palette -> Developer: Reload Window
```

Notes:

- Installing the VSIX is not enough for an already-open test window to pick up changed extension code.
- Reloading the Cursor window restarts the extension host.
- If behavior still looks stale, confirm the VSIX timestamp and rerun packaging before reinstalling.

## Smoke Test

After reload:

- Confirm the CBLite activity bar item is visible.
- Open a database.
- Expand the tree to documents.
- Run document ID search.
- Open one document.
- Save a harmless edit or cancel without saving.

## Git Hygiene

Recommended commit order:

1. Commit implementation changes.
2. Commit spec/documentation changes separately when the docs describe a stable behavior.

Before committing:

```shell
git status --short
git diff --staged
git diff
git log --oneline -5
```

Use concise commit messages in the existing style:

```text
Add multi-database document search
Support document deletion and database upgrades
```

## Publishing Notes

This project currently packages for local installation. Before publishing more broadly:

- Add `repository` to `package.json`.
- Decide whether to increment version manually or automate it.
- Confirm `.vscodeignore` excludes generated and test-only files.
- Test on supported platforms for `cblite` auto-download.
- Verify the downloaded `cblite` asset names still match upstream release naming.
