# Tree State Model

## Purpose

Document how the Databases tree is structured and how state is cached. This should be updated whenever a tree node type, cache key, search behavior, or reveal behavior changes.

## Tree Shape

Normal browsing:

```text
database
  scope
    collection
      document
      Load more
```

After search:

```text
database
  search results
    document
    document
  scope
    collection
      document
```

Search results live inside the database that produced them. This keeps multiple opened databases easy to scan and avoids detached global result rows.

## Node Types

### DatabaseNode

Represents an opened `.cblite2` database.

Fields:

- `type: "database"`
- `databasePath`
- `active`

Tree item:

- Icon: `database`
- Context value: `cbliteDatabase`
- Command: `cblite.selectDatabase`

### ScopeNode

Groups collections by scope name.

Fields:

- `type: "scope"`
- `databasePath`
- `scopeName`

### CollectionNode

Represents a collection inside a scope.

Fields:

- `type: "collection"`
- `databasePath`
- `scopeName`
- `collection`

### DocumentNode

Represents an openable document row.

Fields:

- `type: "document"`
- `databasePath`
- `collectionName`
- `documentId`
- optional `treeId`

`treeId` is used for search result rows so the same document can appear both under a collection and under search results without duplicate tree item IDs.

### LoadMoreNode

Loads the next document page for a collection.

Fields:

- `type: "loadMore"`
- `databasePath`
- `collectionName`

### SearchResultsNode

Contains search results for one database.

Fields:

- `type: "searchResults"`
- `databasePath`
- `pattern`
- `children`
- `resultCount`

Search result nodes are inserted above the normal scope list for their database.

### UpgradeNode

Shown when `cblite` reports that a database must be upgraded.

Fields:

- `type: "upgrade"`
- `databasePath`

### MessageNode

Represents loading, empty, and error rows.

Fields:

- `type: "message"`
- `label`
- optional `description`
- optional `command`
- optional `treeId`

Use `treeId` when multiple message nodes with the same label may appear at once.

## Persistent State

Workspace state keys:

- `cblite.openDatabases`: ordered list of opened database paths.
- `cblite.activeDatabasePath`: currently selected database path.

Opened database order is preserved. Do not sort the list because stable order reduces jumpy UI behavior.

## Runtime Caches

Collection cache:

```text
databasePath -> DatabaseCollection[]
```

Document page cache:

```text
databasePath:collectionName -> DocumentPageState
```

Search result state:

```text
SearchResultsNode[]
```

There is at most one current search result node per opened database.

## Pagination Rules

- Initial collection document load uses 50 documents.
- `Load more` appends the next page to the same collection cache entry.
- `hasNext` is inferred when the returned page size equals the requested limit.

## Search Rules

- Search runs across every opened database.
- Search runs across every collection found for each database.
- Plain search input is treated as a prefix search by the CLI adapter.
- Each database receives one search result node, even when it has no matches or search errors.
- Databases with matches are revealed and expanded after search completes.

## Reveal Requirement

`TreeView.reveal` requires the registered `TreeDataProvider` to implement `getParent`.

The provider must be able to return parents for:

- `searchResults` -> `database`
- `scope` -> `database`
- `collection` -> `scope`
- `document` -> `searchResults` when the document is from search results
- `document` -> `collection` when the document is from normal browsing
- `loadMore` -> `collection`
- `upgrade` -> `database`

If `getParent` is removed or incomplete, search reveal may throw at runtime.

## Invalidation Rules

When a database is removed:

- Remove it from persisted open databases.
- Clear any search result node for that database.
- If it was active, select a neighboring database if available.

When a database is upgraded:

- Clear its collection cache.
- Clear its document page cache entries.
- Refresh the tree and metadata view.

When a database is reloaded:

- Clear its collection cache.
- Clear its document page cache entries.
- Clear any active search result node for that database.
- Re-render the tree so expanding the database loads fresh scopes, collections, and documents.

When a document is deleted:

- Remove it from any loaded page for its collection.
- Remove it from any active search result node for its database.
- Re-render the tree.
