import { execFile, spawn } from "node:child_process";
import { CBLiteDownloader } from "./cbliteDownloader";

export interface DocumentPage {
  ids: string[];
  offset: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface DatabaseMetadata {
  databasePath: string;
  entries: DatabaseMetadataEntry[];
}

export interface DatabaseMetadataEntry {
  label: string;
  value: string;
  category: "general" | "size" | "collections" | "identity" | "raw";
}

export interface DatabaseCollection {
  name: string;
  documentCount?: string;
  lastSequence?: string;
}

export class CBLiteCli {
  constructor(private readonly downloader: CBLiteDownloader) {}

  async listDocuments(databasePath: string, offset: number, limit: number, collectionName?: string): Promise<DocumentPage> {
    const output = collectionName && !isDefaultCollection(collectionName)
      ? await this.runInteractive(databasePath, [`cd ${collectionName}`, `ls -l --offset ${offset} --limit ${limit}`])
      : await this.run(["ls", "-l", "--offset", String(offset), "--limit", String(limit), databasePath]);
    const ids = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("(") && !line.startsWith("Opened ") && !line.startsWith("(cblite)"))
      .map((line) => line.split(/\s+/)[0])
      .filter((id): id is string => Boolean(id) && id !== "Document");

    return {
      ids,
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: ids.length === limit
    };
  }

  async getDocument(databasePath: string, documentId: string, collectionName?: string): Promise<unknown> {
    const output = collectionName && !isDefaultCollection(collectionName)
      ? await this.runInteractive(databasePath, [`cd ${collectionName}`, `cat --raw ${quoteInteractiveArg(documentId)}`])
      : await this.run(["cat", "--raw", databasePath, documentId]);
    try {
      return JSON.parse(extractJsonObject(output));
    } catch (error) {
      throw new Error(`cblite returned invalid JSON for "${documentId}": ${formatError(error)}`);
    }
  }

  async putDocument(databasePath: string, documentId: string, document: unknown, collectionName?: string): Promise<void> {
    const json = JSON.stringify(stripCbliteMetadata(document));
    if (collectionName && !isDefaultCollection(collectionName)) {
      await this.runInteractive(databasePath, [`cd ${collectionName}`, `put ${quoteInteractiveArg(documentId)} ${quoteInteractiveArg(json)}`], true);
      return;
    }

    await this.run(["--writeable", "put", databasePath, documentId, json]);
  }

  async getDatabaseMetadata(databasePath: string): Promise<DatabaseMetadata> {
    const output = await this.getDatabaseInfoOutput(databasePath);
    return {
      databasePath,
      entries: parseDatabaseMetadata(output)
    };
  }

  async listCollections(databasePath: string): Promise<DatabaseCollection[]> {
    try {
      const output = await this.run(["lscoll", databasePath]);
      const collections = parseCollectionList(output);

      if (collections.length > 0) {
        return collections;
      }
    } catch {
      // Older cblite builds do not support lscoll; fall back to info output.
    }

    try {
      const output = await this.getDatabaseInfoOutput(databasePath);
      const collections = parseCollections(output);
      return collections.length > 0 ? collections : [{ name: "_default._default" }];
    } catch {
      return [{ name: "_default._default" }];
    }
  }

  private async getDatabaseInfoOutput(databasePath: string): Promise<string> {
    try {
      return await this.run(["info", "--verbose", databasePath]);
    } catch (verboseError) {
      try {
        return await this.run(["info", databasePath]);
      } catch {
        throw verboseError;
      }
    }
  }

  private async run(args: string[]): Promise<string> {
    const executable = await this.downloader.getExecutablePath();

    return new Promise((resolve, reject) => {
      execFile(executable, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const details = stderr.trim() || stdout.trim() || error.message;
          reject(new Error(`cblite failed: ${details}`));
          return;
        }

        resolve(stdout);
      });
    });
  }

  private async runInteractive(databasePath: string, commands: string[], writeable = false): Promise<string> {
    const executable = await this.downloader.getExecutablePath();
    const args = writeable ? ["--writeable", databasePath] : [databasePath];

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf8");
        const errorOutput = Buffer.concat(stderr).toString("utf8");
        if (code !== 0) {
          reject(new Error(`cblite failed: ${errorOutput.trim() || output.trim() || `exit code ${code}`}`));
          return;
        }

        resolve(output);
      });

      child.stdin.end(`${commands.join("\n")}\nquit\n`);
    });
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripCbliteMetadata(document: unknown): unknown {
  if (!isPlainObject(document)) {
    return document;
  }

  const { _id, _rev, ...body } = document;
  void _id;
  void _rev;
  return body;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDatabaseMetadata(output: string): DatabaseMetadataEntry[] {
  const entries: DatabaseMetadataEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = /^([^:]+):\s*(.*)$/.exec(trimmed);
    if (!match) {
      entries.push({ label: "Info", value: trimmed, category: "raw" });
      continue;
    }

    const [, label, value] = match;
    entries.push(...expandMetadataEntry(label.trim(), value.trim()));
  }

  return entries;
}

function parseCollections(output: string): DatabaseCollection[] {
  const collections: DatabaseCollection[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = /^Collections:\s*"([^"]+)":\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const [, name, details] = match;
    collections.push({
      name,
      documentCount: /(\d+)\s+documents?/.exec(details)?.[1],
      lastSequence: /last sequence\s+#?(\d+)/i.exec(details)?.[1]
    });
  }

  return collections;
}

function parseCollectionList(output: string): DatabaseCollection[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^collection\s+docs\b/i.test(line))
    .filter((line) => !/^-+$/.test(line.replace(/\s+/g, "")))
    .map(parseCollectionListLine)
    .filter((collection): collection is DatabaseCollection => Boolean(collection));
}

function parseCollectionListLine(line: string): DatabaseCollection | undefined {
  const columns = line.split(/\s+/).filter(Boolean);
  const name = columns[0]?.trim();
  if (!name || name.toLowerCase() === "collection") {
    return undefined;
  }

  return {
    name,
    documentCount: /^\d+$/.test(columns[1] ?? "") ? columns[1] : undefined
  };
}

function expandMetadataEntry(label: string, value: string): DatabaseMetadataEntry[] {
  switch (label.toLowerCase()) {
    case "database":
      return [{ label: "Path", value, category: "general" }];
    case "size":
      return parseSizeEntry(value);
    case "collections":
      return parseCollectionEntry(value);
    case "versioning":
      return [{ label: "Versioning", value, category: "general" }];
    case "uuids":
      return parseUuidEntry(value);
    case "shared keys":
      return [{ label: "Shared Keys", value, category: "general" }];
    default:
      return [{ label, value, category: "raw" }];
  }
}

function parseSizeEntry(value: string): DatabaseMetadataEntry[] {
  const entries: DatabaseMetadataEntry[] = [];
  const sizeMatch = /^([^(]+)(?:\((.*)\))?$/.exec(value);
  entries.push({ label: "Database Size", value: sizeMatch?.[1].trim() || value, category: "size" });

  const detailText = sizeMatch?.[2];
  if (!detailText) {
    return entries;
  }

  for (const detail of detailText.split(",")) {
    const detailMatch = /^([^:]+):\s*(.*)$/.exec(detail.trim());
    if (detailMatch) {
      entries.push({ label: toTitleCase(detailMatch[1].trim()), value: detailMatch[2].trim(), category: "size" });
    }
  }

  return entries;
}

function parseCollectionEntry(value: string): DatabaseMetadataEntry[] {
  const match = /^"([^"]+)":\s*(.*)$/.exec(value);
  if (!match) {
    return [{ label: "Collections", value, category: "collections" }];
  }

  const [, collectionName, details] = match;
  const entries: DatabaseMetadataEntry[] = [{ label: "Collection", value: collectionName, category: "collections" }];
  const documentsMatch = /(\d+)\s+documents?/.exec(details);
  const sequenceMatch = /last sequence\s+#?(\d+)/i.exec(details);

  if (documentsMatch) {
    entries.push({ label: `Documents in ${collectionName}`, value: documentsMatch[1], category: "collections" });
  }

  if (sequenceMatch) {
    entries.push({ label: `Last Sequence in ${collectionName}`, value: sequenceMatch[1], category: "collections" });
  }

  if (!documentsMatch && !sequenceMatch) {
    entries.push({ label: collectionName, value: details, category: "collections" });
  }

  return entries;
}

function parseUuidEntry(value: string): DatabaseMetadataEntry[] {
  const match = /^public\s+([^,]+),\s*private\s+(.+)$/.exec(value);
  if (!match) {
    return [{ label: "UUIDs", value, category: "identity" }];
  }

  return [
    { label: "Public UUID", value: match[1], category: "identity" },
    { label: "Private UUID", value: match[2], category: "identity" }
  ];
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function isDefaultCollection(collectionName: string): boolean {
  return collectionName === "_default._default" || collectionName === "_default";
}

function quoteInteractiveArg(value: string): string {
  return JSON.stringify(value);
}

function extractJsonObject(output: string): string {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return output.trim();
  }

  return output.slice(start, end + 1);
}
