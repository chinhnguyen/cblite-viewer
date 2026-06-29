# CBLite Viewer Specification

## Status

Implemented.

## Goal

Provide a Cursor/VS Code extension for opening, browsing, searching, editing, deleting, and inspecting local Couchbase Lite databases through the `cblite` command-line tool.

## User Outcomes

- Users can open one or more local `.cblite2` database directories.
- Users can browse each database as a stable tree: database, scope, collection, document.
- Users can search document IDs across all opened databases.
- Users can open a document as JSON, edit it, and save it back to the source database.
- Users can delete documents from either the tree or an open document editor.
- Users can inspect database metadata in a dedicated view.
- Users can upgrade an older database when the installed `cblite`/LiteCore version requires it.

## Functional Requirements

### Database Management

- The extension must expose a `CBLite` activity bar container.
- The `Databases` view must allow users to open multiple `.cblite2` directories.
- Opened databases must persist in workspace state and survive view switches or reloads.
- Selecting a database must update the active database used by metadata and fallback document commands.
- Removing a database must remove it from the persisted open list without deleting files from disk.

### Tree Navigation

- The `Databases` view must show each opened database as a root row.
- Expanding a database must load collections through `cblite lscoll`.
- If `lscoll` is unavailable, the implementation must fall back to parsing `cblite info`.
- If no collection details can be found, the implementation must fall back to `_default._default`.
- Collections must be grouped by scope.
- Documents must load lazily per collection.
- Initial document loading must use a page size of 50.
- If more documents are available, the collection must show a `Load more` row.
- Tree item IDs must remain stable and globally unique to avoid duplicate registration errors.

### Document Search

- The command `CBLite: Search Documents by ID` must search across all opened databases.
- The Databases view title menu must expose search as an icon toolbar action.
- Plain search text must be treated as a prefix search. For example, `are` becomes `are*`.
- Explicit wildcard patterns must be preserved. For example, `*are*`, `are-*`, and `user?` must be passed through.
- Search must run per database and per collection.
- Search results must appear inside their matching database row, above the normal scope and collection tree.
- Each matching database row must be revealed and expanded after search completes.
- Search result document rows must open the same editor flow as normal document rows.
- Search result rows must use unique tree IDs so they can coexist with the same document under its collection.
- If a database cannot be searched, its result node must show a non-blocking error message instead of failing the whole search.
- If a database has no matches, its result node must show an empty message.

### Document Editing

- Opening a document must fetch raw JSON with `cblite cat --raw`.
- Non-default collections must use interactive `cblite` mode and `cd <collection>` before document operations.
- Opened document files must be stored in extension storage using a database and collection hash.
- Editor filenames should display only the document ID where possible.
- If the active clean document tab belongs to this extension, opening another document may reuse that tab.
- Saving a document must write back through `cblite --writeable put`.
- `_id` and `_rev` metadata must be stripped before writing to avoid illegal top-level key errors.

### Document Deletion

- Users must be able to delete a document from the tree context menu.
- Users must be able to delete the active document from the editor title or context menu.
- Delete actions must ask for modal confirmation.
- Deleting from an editor must close the editor tab after the CLI delete succeeds.
- Deleted document IDs must be removed from loaded collection pages and current search results.

### Metadata

- The `Metadata` view must show useful information returned by `cblite info --verbose`.
- If verbose metadata fails, the extension must retry with `cblite info`.
- Metadata failures must render inside the metadata tree where practical instead of only using notifications.

### CBLite CLI Management

- The extension must use `cbliteViewer.cblitePath` when configured and executable.
- If the configured path cannot run, the extension must automatically download a compatible `cblite` binary.
- Downloaded binaries must be extracted into extension-managed storage and reused.
- CLI calls must surface human-readable errors.

### Database Upgrade

- When `cblite` reports that a database needs to be upgraded, the tree must expose an upgrade action.
- Upgrade must require explicit modal confirmation because it may make the database unreadable by older versions.
- Upgrade must run with `--upgrade`.
- After a successful upgrade, subsequent operations for that database must include `--upgrade` as needed.
- Upgrade must clear cached collections and document pages for that database.

## Implementation Design

### Extension Entry Point

`src/extension.ts` wires together:

- `CBLiteDownloader`
- `CBLiteCli`
- `DatabaseTreeProvider`
- `MetadataTreeProvider`
- `DocumentEditor`

The Databases view is registered with `vscode.window.createTreeView` because search uses `TreeView.reveal` to expand matching database rows.

### CLI Adapter

`src/cbliteCli.ts` is the only module that should know the concrete `cblite` argument structure.

- Standard database operations use `execFile`.
- Collection-specific operations use interactive mode with `spawn`.
- `listDocuments` and `searchDocuments` share the same parser.
- `searchDocuments` normalizes plain text into prefix patterns before invoking `ls`.
- `withUpgrade` injects `--upgrade` only for databases that have been explicitly upgraded in this session.

### Database Tree Provider

`src/databaseTree.ts` owns:

- Open database persistence.
- Active database state.
- Collection cache per database.
- Document page cache per database and collection.
- Search result state per database.
- Parent lookup for `TreeView.reveal`.

The provider must implement both `getChildren` and `getParent`. `getParent` is required because search reveals matching database rows after results are loaded.

Search result nodes are intentionally children of their database node. This keeps the multiple-database UI predictable and prevents global result rows from becoming detached from their source database.

### Document Editor

`src/documentEditor.ts` owns:

- Temporary editable JSON files.
- URI-to-document metadata.
- Save handling.
- Clean tab reuse.
- Active editor context for delete commands.

The editor must not infer document identity from filenames alone. It must use the stored URI metadata because document IDs may overlap across databases or collections.

## Acceptance Criteria

- Opening two databases shows two stable root rows.
- Searching `are` searches all opened databases as `are*`.
- Matching databases expand automatically and show their search results under their own database row.
- Opening a search result opens the correct database, collection, and document.
- Deleting a document removes it from both its collection page and visible search results.
- Saving a document that includes `_id` or `_rev` does not send those keys to `cblite put`.
- An older database that requires upgrade shows an upgrade affordance and only upgrades after confirmation.
- `npm run compile` succeeds.
- `npm run package` succeeds.

## Known Constraints

- Search is limited to the first 50 matches per collection for a given pattern.
- Search currently uses document ID pattern matching provided by `cblite ls`.
- Upgrade state is tracked in memory for the current extension session.
- The VSIX package currently warns when `repository` is missing from `package.json`.
