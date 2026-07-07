# CBLite Viewer

CBLite Viewer is a VS Code extension for viewing and editing local Couchbase Lite databases through the `cblite` command-line tool.

## cblite CLI

The extension uses the Couchbase Mobile Tools `cblite` CLI. If `cblite` is available on your `PATH`, the extension uses it. Otherwise, it automatically downloads the latest compatible release from:

https://github.com/couchbaselabs/couchbase-mobile-tools/releases

To force a default binary, set `cbliteViewer.cblitePath` to the executable path in VS Code settings. If one database needs an older or newer CLI version, use `CBLite: Choose CBLite Download Version` on that database to pick from Couchbase Mobile Tools releases.

## Features

- Open multiple local `.cblite2` database directories from the CBLite activity bar.
- Validate selected folders before adding them to the database list.
- Switch between opened databases by clicking them in the Databases view.
- Keep opened databases available when moving between activity bar views.
- Browse database contents as a tree: database, scope, collection, document.
- Reload one database from its row to refresh scopes, collections, and loaded documents.
- Automatically expand `_default._default` after opening or reloading a database when it exists.
- Search document IDs across all opened databases with exact IDs or wildcard patterns.
- Load documents in batches of 50 with a `Load more` row.
- Upgrade older databases after confirmation when the current `cblite` version requires it.
- Use a database-specific downloaded `cblite` version instead of upgrading when you need to keep an older database format.
- Inspect useful database metadata like size, document counts, collections, sequences, UUIDs, and versioning.
- Open a document as editable JSON.
- Copy document IDs from document rows.
- Save JSON changes back to the database with `cblite --writeable put`.
- Delete documents from the tree or from an open document editor.

## Commands

- `CBLite: Open Database`
- `CBLite: Remove Database From Open List`
- `CBLite: Reload Database`
- `CBLite: Upgrade Database`
- `CBLite: Choose CBLite Download Version`
- `CBLite: Use Default CBLite`
- `CBLite: Refresh Metadata`
- `CBLite: Search Documents by ID`
- `CBLite: View/Edit Document`
- `CBLite: Copy Document ID`
- `CBLite: Delete Document`

## Development

```sh
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
