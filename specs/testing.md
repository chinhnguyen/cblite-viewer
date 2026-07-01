# Testing Checklist

## Purpose

Provide a repeatable regression checklist for local extension development in Cursor.

## Fast Verification

Run before installing a test build:

```shell
npm run compile
npm run package
cursor --install-extension "cblite-vscode-0.0.1.vsix" --force
```

Then reload the test window:

```text
Command Palette -> Developer: Reload Window
```

Expected:

- Compile succeeds.
- VSIX packaging succeeds.
- The only known packaging warning is the missing `repository` field.
- Cursor reports the VSIX was installed successfully.

## Activity Bar and Views

Expected:

- The CBLite activity bar icon is visible.
- The CBLite container has `Databases` and `Metadata` views.
- Databases view title actions render as icons, not text labels.
- Search and open-database toolbar actions are visible.

## Opening Databases

Steps:

1. Run `CBLite: Open Database`.
2. Select a `.cblite2` directory.
3. Open at least two databases.
4. Switch away from the CBLite activity bar and back.
5. Reload the window.

Expected:

- Opened databases remain visible.
- Database order stays stable.
- Database rows use the database icon.
- No selected database indentation is introduced.

## Tree Browsing

Steps:

1. Expand a database.
2. Expand a scope.
3. Expand a collection.
4. Click `Load more` if present.

Expected:

- Collections appear under scopes.
- Collection table headers such as `Collection Docs Deleted Expiring` are not shown as data rows.
- Documents appear without an extra `Document` header.
- `Load more` appends documents instead of replacing the current list.
- No duplicate tree item ID errors appear.

## Multi-Database Search

Steps:

1. Open multiple databases.
2. Collapse their database rows.
3. Run `CBLite: Search Documents by ID`.
4. Enter a known prefix such as `are`.
5. Repeat with an explicit wildcard pattern such as `*are*`.

Expected:

- Plain text behaves as prefix search, so `are` searches as `are*`.
- Search runs across all opened databases.
- Each searched database contains its own search result node.
- Databases with matches expand automatically.
- Search result rows are visible under the matching database.
- Search result rows open the correct document.
- No `getParent` or `TreeView.reveal` errors appear.

## Document Editing

Steps:

1. Open a document from the normal tree.
2. Open another document while the first editor is clean.
3. Modify a document.
4. Save.

Expected:

- Clean extension document tabs may be reused.
- Dirty tabs are not closed automatically.
- The editor filename is the document ID.
- Save writes through `cblite --writeable put`.
- Documents containing `_id` or `_rev` save without `illegal top-level key` errors.

## Document Deletion

Tree deletion:

1. Right-click a document row.
2. Run `CBLite: Delete Document`.
3. Confirm deletion.

Editor deletion:

1. Open a document.
2. Run delete from the editor title or context menu.
3. Confirm deletion.

Expected:

- Delete asks for modal confirmation.
- CLI delete succeeds before UI state is changed.
- Deleted documents disappear from loaded collection pages.
- Deleted documents disappear from visible search results.
- Deleting from the editor closes that editor tab.

## Metadata View

Steps:

1. Select an opened database.
2. Open the Metadata view.
3. Refresh metadata.

Expected:

- Metadata loads with useful `cblite info` fields.
- If `info --verbose` fails, the fallback `info` path is used.
- Metadata errors render in the view when practical.

## Upgrade Flow

Use a disposable copy of an older database.

Steps:

1. Open a database that requires upgrade.
2. Expand it or try to load documents.
3. Choose the upgrade action.
4. Confirm the modal warning.

Expected:

- The extension does not upgrade without explicit confirmation.
- The extension offers selecting a different `cblite` executable as an alternative to upgrade.
- Upgrade runs with `--upgrade`.
- After success, tree caches refresh.
- Subsequent reads and writes for that database work in the same session.

## Database-Specific CBLite Version

Use a database that requires a different `cblite` version.

Steps:

1. Right-click the database row.
2. Run `CBLite: Choose CBLite Download Version`.
3. Select a release from the Couchbase Mobile Tools download picker.
4. Expand the database and load documents.
5. Right-click the database row.
6. Run `CBLite: Use Default CBLite`.

Expected:

- The picker lists platform-compatible release downloads.
- Each option shows the release name, asset name, and LiteCore compatibility signal when available.
- The extension does not claim an exact `.cblite2` format mapping unless upstream metadata declares it.
- The selected release downloads and extracts into extension storage.
- The downloaded executable is validated with `--version`.
- The override applies only to the selected database.
- Collections, documents, metadata, search, edit, and delete use the selected executable for that database.
- Clearing the override returns the database to the global configured or auto-downloaded executable.
- Changing the override clears cached collections, document pages, and search results for that database.

## Failure Cases

Verify these fail gracefully:

- `cbliteViewer.cblitePath` points to a missing executable.
- `lscoll` is unavailable.
- `info --verbose` fails.
- A search database cannot be read.
- A document no longer exists when opened.
- A delete operation fails.

Expected:

- Errors are human-readable.
- One failed database search does not prevent other database results from showing.
- The extension does not remove local database files when removing a database from the open list.
