import * as vscode from "vscode";
import { CBLiteCli, DatabaseMetadataEntry } from "./cbliteCli";

type MetadataCategory = DatabaseMetadataEntry["category"];

export type MetadataTreeNode = SectionNode | EntryNode | MessageNode;

interface SectionNode {
  type: "section";
  label: string;
  category: MetadataCategory;
  entries: DatabaseMetadataEntry[];
}

interface EntryNode {
  type: "entry";
  label: string;
  value: string;
  category: MetadataCategory;
}

interface MessageNode {
  type: "message";
  label: string;
  description?: string;
  command?: string;
}

const CATEGORY_LABELS: Record<MetadataCategory, string> = {
  general: "General",
  size: "Storage",
  collections: "Collections",
  identity: "Identity",
  raw: "Other"
};

const CATEGORY_ICONS: Record<MetadataCategory, string> = {
  general: "info",
  size: "symbol-numeric",
  collections: "files",
  identity: "key",
  raw: "list-flat"
};

export class MetadataTreeProvider implements vscode.TreeDataProvider<MetadataTreeNode> {
  private readonly didChangeTreeData = new vscode.EventEmitter<MetadataTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.didChangeTreeData.event;

  private databasePath: string | undefined;
  private entries: DatabaseMetadataEntry[] | undefined;
  private isLoading = false;
  private loadGeneration = 0;

  constructor(private readonly cli: CBLiteCli) {}

  async setDatabase(databasePath: string | undefined): Promise<void> {
    this.databasePath = databasePath;
    this.entries = undefined;
    this.loadGeneration += 1;

    if (databasePath) {
      await this.loadMetadata();
      return;
    }

    this.isLoading = false;
    this.didChangeTreeData.fire();
  }

  async refresh(): Promise<void> {
    await this.loadMetadata();
  }

  getTreeItem(element: MetadataTreeNode): vscode.TreeItem {
    switch (element.type) {
      case "section":
        return {
          id: `section:${element.category}`,
          label: element.label,
          iconPath: new vscode.ThemeIcon(CATEGORY_ICONS[element.category]),
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded
        };
      case "entry":
        return {
          id: `entry:${element.category}:${element.label}:${element.value}`,
          label: element.label,
          description: element.value,
          tooltip: `${element.label}: ${element.value}`,
          iconPath: new vscode.ThemeIcon("circle-small-filled"),
          collapsibleState: vscode.TreeItemCollapsibleState.None
        };
      case "message":
        return {
          id: `message:${element.label}`,
          label: element.label,
          description: element.description,
          iconPath: new vscode.ThemeIcon("info"),
          command: element.command
            ? {
                title: element.label,
                command: element.command
              }
            : undefined,
          collapsibleState: vscode.TreeItemCollapsibleState.None
        };
    }
  }

  async getChildren(element?: MetadataTreeNode): Promise<MetadataTreeNode[]> {
    if (element?.type === "section") {
      return element.entries.map<EntryNode>((entry) => ({
        type: "entry",
        label: entry.label,
        value: entry.value,
        category: entry.category
      }));
    }

    if (!this.databasePath) {
      return [
        {
          type: "message",
          label: "Select a database",
          description: "Open or choose one in Databases",
          command: "cblite.openDatabase"
        }
      ];
    }

    if (this.isLoading) {
      return [
        {
          type: "message",
          label: "Loading metadata..."
        }
      ];
    }

    if (!this.entries || this.entries.length === 0) {
      return [
        {
          type: "message",
          label: "No metadata available"
        }
      ];
    }

    return createSections(this.entries);
  }

  private async loadMetadata(): Promise<void> {
    if (!this.databasePath) {
      this.entries = undefined;
      this.isLoading = false;
      this.didChangeTreeData.fire();
      return;
    }

    const databasePath = this.databasePath;
    const generation = ++this.loadGeneration;
    this.isLoading = true;
    this.didChangeTreeData.fire();

    try {
      const metadata = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Loading Couchbase Lite metadata"
        },
        () => this.cli.getDatabaseMetadata(databasePath)
      );

      if (generation !== this.loadGeneration || databasePath !== this.databasePath) {
        return;
      }

      this.entries = metadata.entries;
    } catch (error) {
      if (generation !== this.loadGeneration) {
        return;
      }

      this.entries = [
        {
          label: "Metadata unavailable",
          value: formatCbliteError(error),
          category: "raw"
        }
      ];
    } finally {
      if (generation !== this.loadGeneration) {
        return;
      }

      this.isLoading = false;
      this.didChangeTreeData.fire();
    }
  }
}

function createSections(entries: DatabaseMetadataEntry[]): SectionNode[] {
  const sections: SectionNode[] = [];
  for (const category of ["general", "size", "collections", "identity", "raw"] satisfies MetadataCategory[]) {
    const categoryEntries = entries.filter((entry) => entry.category === category);
    if (categoryEntries.length === 0) {
      continue;
    }

    sections.push({
      type: "section",
      label: CATEGORY_LABELS[category],
      category,
      entries: categoryEntries
    });
  }

  return sections;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCbliteError(error: unknown): string {
  return formatError(error).replace(/^cblite failed:\s*/i, "");
}
