# CBLite CLI Contract

## Purpose

Document the expected `cblite` command behavior used by the extension. This is the main contract to revisit when upgrading `cblite`, supporting a new platform, or fixing parsing bugs.

## Executable Resolution

- Prefer `cbliteViewer.cblitePath` when it points to a runnable executable.
- If the configured executable cannot run, download a compatible binary through `CBLiteDownloader`.
- Downloaded binaries are stored in extension-managed global storage.

## Standard Commands

### List Documents

Default collection:

```shell
cblite ls -l --offset <offset> --limit <limit> <databasePath>
```

Search default collection:

```shell
cblite ls -l --offset 0 --limit <limit> <databasePath> <pattern>
```

Notes:

- The database path must appear before the optional search pattern.
- Plain user input is normalized before reaching this command. For example, `are` becomes `are*`.
- Explicit wildcard patterns are preserved.

### Read Document

```shell
cblite cat --raw <databasePath> <documentId>
```

The extension extracts and parses the JSON object from stdout.

### Write Document

```shell
cblite --writeable put <databasePath> <documentId> <json>
```

The extension strips `_id` and `_rev` before writing because `cblite put` rejects those top-level metadata keys.

### Delete Document

```shell
cblite --writeable rm <databasePath> <documentId>
```

Delete is only called after user confirmation.

### Database Info

Preferred:

```shell
cblite info --verbose <databasePath>
```

Fallback:

```shell
cblite info <databasePath>
```

The fallback exists because some `cblite` versions fail on verbose metadata.

### List Collections

Preferred:

```shell
cblite lscoll <databasePath>
```

Fallback:

```shell
cblite info <databasePath>
```

If neither returns collection information, assume `_default._default`.

## Interactive Collection Commands

Non-default collections use interactive mode so the extension can `cd` into a collection before running document operations.

Read-only:

```shell
cblite <databasePath>
cd <collectionName>
ls -l --offset <offset> --limit <limit> [pattern]
quit
```

Writeable:

```shell
cblite --writeable <databasePath>
cd <collectionName>
put <documentId> <json>
quit
```

Delete:

```shell
cblite --writeable <databasePath>
cd <collectionName>
rm <documentId>
quit
```

Arguments sent to interactive commands must be quoted when they contain spaces or shell-sensitive characters.

## Upgrade Behavior

Upgrade command:

```shell
cblite --upgrade info <databasePath>
```

After an explicit upgrade succeeds, subsequent operations for that database may prepend `--upgrade`.

Upgrade-required errors are detected by matching messages that mention:

- `needs to be upgraded`
- `--upgrade`
- `CantUpgradeDatabase`

## Output Parsing Assumptions

Document listing parser:

- Trim each line.
- Ignore empty lines.
- Ignore prompt/status lines such as `(cblite)` and `Opened ...`.
- Use the first whitespace-separated field as the document ID.
- Ignore header field `Document`.

Collection parsing:

- Prefer `lscoll` structured rows.
- Handle padded columns and single-space separated columns.
- Filter collection table headers before creating tree rows.

## Version Compatibility Risks

- `lscoll` may be missing in older versions.
- `info --verbose` may fail on some databases or CLI builds.
- Older databases may require `--upgrade`.
- Document listing output is text-based and can regress if the CLI changes headers or column order.
