import * as path from "node:path";
import * as vscode from "vscode";
import { CBLiteCli, DatabaseCollection, isDatabaseUpgradeRequiredError } from "./cbliteCli";

export interface OpenedDatabase {
  databasePath: string;
}

export type DatabaseTreeNode = DatabaseNode | ScopeNode | CollectionNode | DocumentNode | LoadMoreNode | UpgradeNode | MessageNode;

export interface DatabaseNode extends OpenedDatabase {
  type: "database";
  active: boolean;
}

interface ScopeNode {
  type: "scope";
  databasePath: string;
  scopeName: string;
}

interface CollectionNode {
  type: "collection";
  databasePath: string;
  scopeName: string;
  collection: DatabaseCollection;
}

export interface DocumentNode {
  type: "document";
  databasePath: string;
  collectionName: string;
  documentId: string;
}

interface LoadMoreNode {
  type: "loadMore";
  databasePath: string;
  collectionName: string;
}

export interface UpgradeNode {
  type: "upgrade";
  databasePath: string;
}

interface MessageNode {
  type: "message";
  label: string;
  description?: string;
  command?: string;
}

const DATABASES_STATE_KEY = "cblite.openDatabases";
const ACTIVE_DATABASE_STATE_KEY = "cblite.activeDatabasePath";
const INITIAL_DOCUMENT_LIMIT = 50;

interface DocumentPageState {
  ids: string[];
  offset: number;
  hasNext: boolean;
  isLoading: boolean;
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DatabaseTreeNode> {
  private readonly didChangeTreeData = new vscode.EventEmitter<DatabaseTreeNode | undefined | null | void>();
  private readonly didChangeActiveDatabase = new vscode.EventEmitter<OpenedDatabase | undefined>();

  readonly onDidChangeTreeData = this.didChangeTreeData.event;
  readonly onDidChangeActiveDatabase = this.didChangeActiveDatabase.event;

  private readonly databases: OpenedDatabase[];
  private activeDatabasePath: string | undefined;
  private readonly collections = new Map<string, DatabaseCollection[]>();
  private readonly loadingCollections = new Set<string>();
  private readonly documentPages = new Map<string, DocumentPageState>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cli: CBLiteCli
  ) {
    this.databases = context.workspaceState.get<OpenedDatabase[]>(DATABASES_STATE_KEY, []);
    this.activeDatabasePath = context.workspaceState.get<string | undefined>(ACTIVE_DATABASE_STATE_KEY);

    if (this.activeDatabasePath && !this.databases.some((database) => database.databasePath === this.activeDatabasePath)) {
      this.activeDatabasePath = this.databases[0]?.databasePath;
    }
  }

  get activeDatabase(): OpenedDatabase | undefined {
    return this.databases.find((database) => database.databasePath === this.activeDatabasePath);
  }

  emitActiveDatabase(): void {
    this.didChangeActiveDatabase.fire(this.activeDatabase);
  }

  openDatabase(databasePath: string): void {
    if (!this.databases.some((database) => database.databasePath === databasePath)) {
      this.databases.push({ databasePath });
      void this.persistDatabases();
    }

    this.selectDatabase({ databasePath });
  }

  selectDatabase(database: OpenedDatabase): void {
    if (this.activeDatabasePath === database.databasePath) {
      return;
    }

    this.activeDatabasePath = database.databasePath;
    void this.persistActiveDatabase();
    this.didChangeTreeData.fire();
    this.didChangeActiveDatabase.fire(this.activeDatabase);
  }

  closeDatabase(database: OpenedDatabase): void {
    const index = this.databases.findIndex((item) => item.databasePath === database.databasePath);
    if (index === -1) {
      return;
    }

    const wasActive = this.databases[index].databasePath === this.activeDatabasePath;
    this.databases.splice(index, 1);

    if (wasActive) {
      this.activeDatabasePath = this.databases[Math.min(index, this.databases.length - 1)]?.databasePath;
      void this.persistActiveDatabase();
      this.didChangeActiveDatabase.fire(this.activeDatabase);
    }

    void this.persistDatabases();
    this.didChangeTreeData.fire();
  }

  getTreeItem(element: DatabaseTreeNode): vscode.TreeItem {
    switch (element.type) {
      case "database":
        return {
          id: `database:${element.databasePath}`,
          label: getDatabaseLabel(element.databasePath),
          description: element.databasePath,
          tooltip: element.active ? `Active database: ${element.databasePath}` : element.databasePath,
          iconPath: new vscode.ThemeIcon("database"),
          contextValue: "cbliteDatabase",
          command: {
            title: "Show Documents",
            command: "cblite.selectDatabase",
            arguments: [element]
          },
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
      case "scope":
        return {
          id: `scope:${element.databasePath}:${element.scopeName}`,
          label: element.scopeName,
          iconPath: new vscode.ThemeIcon("symbol-namespace"),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
      case "collection":
        return {
          id: `collection:${element.databasePath}:${element.collection.name}`,
          label: getCollectionLabel(element.collection.name),
          description: element.collection.documentCount ? `${element.collection.documentCount} docs` : undefined,
          tooltip: formatCollectionTooltip(element.collection),
          iconPath: new vscode.ThemeIcon("library"),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
      case "document":
        return {
          id: `document:${element.databasePath}:${element.collectionName}:${element.documentId}`,
          label: element.documentId,
          contextValue: "cbliteDocument",
          command: {
            title: "View/Edit Document",
            command: "cblite.openDocument",
            arguments: [element]
          },
          collapsibleState: vscode.TreeItemCollapsibleState.None
        };
      case "loadMore":
        return {
          id: `loadMore:${element.databasePath}:${element.collectionName}`,
          label: "Load more",
          iconPath: new vscode.ThemeIcon("ellipsis"),
          command: {
            title: "Load More Documents",
            command: "cblite.loadMoreDocuments",
            arguments: [element]
          },
          collapsibleState: vscode.TreeItemCollapsibleState.None
        };
      case "upgrade":
        return {
          id: `upgrade:${element.databasePath}`,
          label: "Upgrade database to open it",
          description: "Required",
          iconPath: new vscode.ThemeIcon("warning"),
          command: {
            title: "Upgrade Database",
            command: "cblite.upgradeDatabase",
            arguments: [element]
          },
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

  async getChildren(element?: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
    if (element?.type === "database") {
      return this.getDatabaseChildren(element);
    }

    if (element?.type === "scope") {
      return this.getScopeChildren(element);
    }

    if (element?.type === "collection") {
      return this.getCollectionChildren(element);
    }

    if (this.databases.length === 0) {
      return [
        {
          type: "message",
          label: "Open a Couchbase Lite database",
          description: "Add one or more .cblite2 folders",
          command: "cblite.openDatabase"
        }
      ];
    }

    return this.databases.map<DatabaseNode>((database) => ({
      type: "database",
      databasePath: database.databasePath,
      active: database.databasePath === this.activeDatabasePath
    }));
  }

  async loadMoreDocuments(node: LoadMoreNode): Promise<void> {
    await this.loadDocuments(node.databasePath, node.collectionName, true);
  }

  async upgradeDatabase(databasePath: string): Promise<void> {
    await this.cli.upgradeDatabase(databasePath);
    this.collections.delete(databasePath);
    for (const pageKey of this.documentPages.keys()) {
      if (pageKey.startsWith(`${databasePath}:`)) {
        this.documentPages.delete(pageKey);
      }
    }
    this.didChangeTreeData.fire();
    this.didChangeActiveDatabase.fire(this.activeDatabase);
  }

  forgetDocument(document: Pick<DocumentNode, "databasePath" | "collectionName" | "documentId">): void {
    const pageKey = getDocumentPageKey(document.databasePath, document.collectionName);
    const page = this.documentPages.get(pageKey);
    if (!page) {
      return;
    }

    this.documentPages.set(pageKey, {
      ...page,
      ids: page.ids.filter((documentId) => documentId !== document.documentId)
    });
    this.didChangeTreeData.fire();
  }

  private async getDatabaseChildren(database: DatabaseNode): Promise<DatabaseTreeNode[]> {
    if (this.loadingCollections.has(database.databasePath)) {
      return [{ type: "message", label: "Loading collections..." }];
    }

    let collections: DatabaseCollection[];
    try {
      collections = await this.getCollections(database.databasePath);
    } catch (error) {
      if (isDatabaseUpgradeRequiredError(error)) {
        return [{ type: "upgrade", databasePath: database.databasePath }];
      }

      throw error;
    }
    if (collections.length === 0) {
      return [{ type: "message", label: "No collections found" }];
    }

    return getScopeNames(collections).map<ScopeNode>((scopeName) => ({
      type: "scope",
      databasePath: database.databasePath,
      scopeName
    }));
  }

  private async getScopeChildren(scope: ScopeNode): Promise<DatabaseTreeNode[]> {
    const collections = await this.getCollections(scope.databasePath);
    return collections
      .filter((collection) => getScopeName(collection.name) === scope.scopeName)
      .map<CollectionNode>((collection) => ({
        type: "collection",
        databasePath: scope.databasePath,
        scopeName: scope.scopeName,
        collection
      }));
  }

  private async getCollectionChildren(collection: CollectionNode): Promise<DatabaseTreeNode[]> {
    const collectionName = collection.collection.name;
    const pageKey = getDocumentPageKey(collection.databasePath, collectionName);
    let page = this.documentPages.get(pageKey);
    if (!page) {
      await this.loadDocuments(collection.databasePath, collectionName, false);
      page = this.documentPages.get(pageKey);
    }

    if (!page || page.isLoading) {
      return [{ type: "message", label: "Loading documents..." }];
    }

    if (page.ids.length === 0) {
      return [{ type: "message", label: "No documents found" }];
    }

    const documents = page.ids.map<DocumentNode>((documentId) => ({
      type: "document",
      databasePath: collection.databasePath,
      collectionName,
      documentId
    }));

    if (!page.hasNext) {
      return documents;
    }

    return [
      ...documents,
      {
        type: "loadMore",
        databasePath: collection.databasePath,
        collectionName
      }
    ];
  }

  private async getCollections(databasePath: string): Promise<DatabaseCollection[]> {
    const cached = this.collections.get(databasePath);
    if (cached) {
      return cached;
    }

    this.loadingCollections.add(databasePath);
    try {
      const collections = await this.cli.listCollections(databasePath);
      this.collections.set(databasePath, collections);
      return collections;
    } finally {
      this.loadingCollections.delete(databasePath);
    }
  }

  private async loadDocuments(databasePath: string, collectionName: string, append: boolean): Promise<void> {
    const pageKey = getDocumentPageKey(databasePath, collectionName);
    const currentPage = this.documentPages.get(pageKey);
    const offset = append ? currentPage?.offset ?? 0 : 0;

    this.documentPages.set(pageKey, {
      ids: currentPage?.ids ?? [],
      offset,
      hasNext: currentPage?.hasNext ?? true,
      isLoading: true
    });
    this.didChangeTreeData.fire();

    try {
      const page = await this.cli.listDocuments(databasePath, offset, INITIAL_DOCUMENT_LIMIT, collectionName);
      this.documentPages.set(pageKey, {
        ids: append ? [...(currentPage?.ids ?? []), ...page.ids] : page.ids,
        offset: offset + page.ids.length,
        hasNext: page.hasNext,
        isLoading: false
      });
    } catch (error) {
      if (isDatabaseUpgradeRequiredError(error)) {
        void vscode.window.showWarningMessage(
          "This database needs to be upgraded before documents can be loaded.",
          "Upgrade Database"
        ).then((selection) => {
          if (selection === "Upgrade Database") {
            void vscode.commands.executeCommand("cblite.upgradeDatabase", { type: "upgrade", databasePath });
          }
        });
      }

      this.documentPages.set(pageKey, {
        ids: currentPage?.ids ?? [],
        offset: currentPage?.offset ?? 0,
        hasNext: false,
        isLoading: false
      });
      void vscode.window.showErrorMessage(formatError(error));
    } finally {
      this.didChangeTreeData.fire();
    }
  }

  private async persistDatabases(): Promise<void> {
    await this.context.workspaceState.update(DATABASES_STATE_KEY, this.databases);
  }

  private async persistActiveDatabase(): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_DATABASE_STATE_KEY, this.activeDatabasePath);
  }
}

function getDatabaseLabel(databasePath: string): string {
  return path.basename(databasePath);
}

function getScopeNames(collections: DatabaseCollection[]): string[] {
  return [...new Set(collections.map((collection) => getScopeName(collection.name)))];
}

function getScopeName(collectionName: string): string {
  return collectionName.includes(".") ? collectionName.split(".")[0] : "_default";
}

function getCollectionLabel(collectionName: string): string {
  return collectionName.includes(".") ? collectionName.split(".").slice(1).join(".") : collectionName;
}

function getDocumentPageKey(databasePath: string, collectionName: string): string {
  return `${databasePath}:${collectionName}`;
}

function formatCollectionDescription(collection: DatabaseCollection): string | undefined {
  const details = [];
  if (collection.documentCount) {
    details.push(`${collection.documentCount} docs`);
  }
  if (collection.lastSequence) {
    details.push(`seq ${collection.lastSequence}`);
  }

  return details.length > 0 ? details.join(", ") : undefined;
}

function formatCollectionTooltip(collection: DatabaseCollection): string {
  const description = formatCollectionDescription(collection);
  return description ? `${collection.name}: ${description}` : collection.name;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
