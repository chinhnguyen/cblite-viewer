# Implementation Decisions

## Purpose

Record the rationale behind important implementation choices. Keep entries short and update this file when a decision changes.

## Use `cblite` Instead Of Direct Database Access

Decision:

- Interact with Couchbase Lite databases through the official `cblite` CLI.

Rationale:

- Avoid binding the extension to Couchbase Lite storage internals.
- Match the user's requested integration point.
- Keep database compatibility delegated to the Couchbase tooling.

Tradeoffs:

- The extension must parse text output.
- CLI version differences require fallback behavior.
- Operations are slower than direct embedded access.

## Auto-Download `cblite`

Decision:

- Try the configured path first, then automatically download `cblite` when needed.

Rationale:

- Users should not need to install the CLI manually before the extension can work.
- Advanced users can still pin a specific executable with `cbliteViewer.cblitePath`.

Tradeoffs:

- The downloader must track platform and architecture-specific assets.
- Upstream release naming changes can break auto-download.

## Keep Opened Databases In Workspace State

Decision:

- Persist opened databases and active database path in `context.workspaceState`.

Rationale:

- Opened databases should survive switching activity bar views and window reloads.
- Workspace state is appropriate because database lists are tied to the current workspace.

Tradeoffs:

- Opened databases are not global across all workspaces.

## Preserve Database Insertion Order

Decision:

- Do not sort opened databases.

Rationale:

- Sorting caused list movement and made the UI feel jumpy.
- Insertion order is easier for users to predict.

Tradeoffs:

- Users cannot currently choose a custom sort order.

## Consolidate Navigation Into One Tree

Decision:

- Use one Databases tree for database, scope, collection, document, search, and upgrade rows.

Rationale:

- Users can understand the hierarchy from source database down to document.
- Search results stay attached to the database that produced them.
- Fewer separate views reduces context switching.

Tradeoffs:

- The tree provider has more node types and parent lookup complexity.

## Store Search Results Under Each Database

Decision:

- Search across all opened databases, then insert each result group under its database row.

Rationale:

- Multiple database search needs clear source context.
- Nested results avoid a global list that can feel detached from the tree.
- Revealing matching database rows makes results visible even when rows start collapsed.

Tradeoffs:

- The provider must implement `getParent` for `TreeView.reveal`.
- The same document can appear in search results and under its collection, requiring unique tree IDs.

## Treat Plain Search Text As Prefix Search

Decision:

- Convert plain search input to a prefix wildcard pattern.

Rationale:

- Users expect entering `are` to find IDs starting with `are`.
- Explicit wildcard input remains available for broader matching.

Tradeoffs:

- Exact-match-only search is not the default. Users can still use a pattern that only matches the exact ID if supported by `cblite`.

## Use Temporary JSON Files For Editing

Decision:

- Write fetched documents into extension storage and open them as normal JSON files.

Rationale:

- Reuses VS Code's editor, JSON syntax highlighting, dirty tracking, and save events.
- Avoids building a custom editor for basic document editing.

Tradeoffs:

- The extension must maintain URI-to-document metadata.
- The temporary filename is not enough to identify the source database and collection.

## Strip `_id` And `_rev` On Save

Decision:

- Remove `_id` and `_rev` before calling `cblite put`.

Rationale:

- `cblite put` rejects these top-level metadata keys.
- Users may receive these fields from `cat --raw`, so save should handle them automatically.

Tradeoffs:

- The editor content may include metadata that is not written back as document body data.

## Reuse Clean Document Tabs

Decision:

- Reuse a clean extension-owned document tab when opening another document.

Rationale:

- Repeated document browsing should not create a long list of tabs.
- Dirty tabs must remain open to protect unsaved work.

Tradeoffs:

- The extension must track active editor context and close only extension-owned clean tabs.

## Require Confirmation For Delete And Upgrade

Decision:

- Delete and upgrade operations require modal confirmation.

Rationale:

- Delete is destructive.
- Upgrade may make the database unreadable by older LiteCore versions.

Tradeoffs:

- Adds one extra step for experienced users.

## Track Upgrade State In Memory

Decision:

- Keep upgraded database paths in memory for the extension session.

Rationale:

- Avoid persisting a potentially sensitive or misleading flag.
- The source of truth is still the database and `cblite` behavior.

Tradeoffs:

- After reload, the extension may need to detect upgrade requirements again.

## Support Per-Database CBLite Versions

Decision:

- Allow users to pin a specific downloaded `cblite` release to an opened database.

Rationale:

- Some older databases should remain in their current format instead of being upgraded.
- A matching older `cblite` can open those databases without making them unreadable by older LiteCore versions.
- Different opened databases may require different CLI versions.
- Listing release downloads is safer and easier than asking users to find local binaries manually.

Tradeoffs:

- The extension depends on the Couchbase Mobile Tools GitHub release metadata and asset naming.
- Stored executable paths can become stale if binaries are moved.
- Cache invalidation is required when an override changes because collection and document behavior can differ by CLI version.
- Exact `.cblite2` format mappings are not published in release metadata, so the UI uses LiteCore version as the compatibility signal.

## Show Recoverable Errors In The Tree

Decision:

- Prefer inline tree messages for recoverable metadata, search, and empty states.

Rationale:

- Users can see which database or branch failed without losing context.
- One database failure should not hide successful results from other databases.

Tradeoffs:

- Tree nodes need unique IDs for repeated messages.
