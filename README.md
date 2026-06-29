# CBLite Viewer

CBLite Viewer is a VS Code extension for viewing and editing local Couchbase Lite databases through the `cblite` command-line tool.

## cblite CLI

The extension uses the Couchbase Mobile Tools `cblite` CLI. If `cblite` is available on your `PATH`, the extension uses it. Otherwise, it automatically downloads the latest compatible release from:

https://github.com/couchbaselabs/couchbase-mobile-tools/releases

To force a specific binary, set `cbliteViewer.cblitePath` to the executable path in VS Code settings.

## Features

- Open multiple local `.cblite2` database directories from the CBLite activity bar.
- Switch between opened databases by clicking them in the Databases view.
- Keep opened databases available when moving between activity bar views.
- Browse database contents as a tree: database, scope, collection, document.
- Load documents in batches of 50 with a `Load more` row.
- Inspect useful database metadata like size, document counts, collections, sequences, UUIDs, and versioning.
- Open a document as editable JSON.
- Save JSON changes back to the database with `cblite --writeable put`.

## Commands

- `CBLite: Open Database`
- `CBLite: Remove Database From Open List`
- `CBLite: Refresh Metadata`
- `CBLite: View/Edit Document`

## Development

```sh
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
