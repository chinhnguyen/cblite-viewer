import * as vscode from "vscode";
import { CBLiteCli, isDatabaseUpgradeRequiredError } from "./cbliteCli";
import { CBLiteDownloader, CBLiteDownloadOption } from "./cbliteDownloader";
import { CBLitePathNode, DatabaseNode, DatabaseTreeProvider, DocumentNode, OpenedDatabase, UpgradeNode } from "./databaseTree";
import { DocumentEditor } from "./documentEditor";
import { MetadataTreeProvider } from "./metadataTree";

export function activate(context: vscode.ExtensionContext): void {
  const downloader = new CBLiteDownloader(context);
  const cli = new CBLiteCli(downloader);
  const databaseProvider = new DatabaseTreeProvider(context, cli);
  const metadataProvider = new MetadataTreeProvider(cli);
  const editor = new DocumentEditor(context, cli);
  const databaseTreeView = vscode.window.createTreeView("cbliteDatabases", {
    treeDataProvider: databaseProvider
  });

  context.subscriptions.push(
    editor,
    databaseTreeView,
    databaseProvider.onDidChangeActiveDatabase(async (database) => {
      await metadataProvider.setDatabase(database?.databasePath);
    }),
    vscode.window.registerTreeDataProvider("cbliteMetadata", metadataProvider),
    vscode.commands.registerCommand("cblite.openDatabase", async () => {
      const databasePath = await pickDatabasePath();
      if (!databasePath) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Validating Couchbase Lite database",
            cancellable: false
          },
          () => cli.validateDatabasePath(databasePath)
        );
        databaseProvider.openDatabase(databasePath);
        await revealDefaultCollection(databasePath);
      } catch (error) {
        if (isDatabaseUpgradeRequiredError(error)) {
          databaseProvider.openDatabase(databasePath);
          void vscode.window.showWarningMessage(
            "This looks like a Couchbase Lite database, but it needs upgrade or a compatible cblite version before it can be opened.",
            "Upgrade Database",
            "Choose CBLite Version"
          ).then((selection) => {
            if (selection === "Upgrade Database") {
              void vscode.commands.executeCommand("cblite.upgradeDatabase", { databasePath });
            } else if (selection === "Choose CBLite Version") {
              void vscode.commands.executeCommand("cblite.setDatabaseCblitePath", { databasePath });
            }
          });
          return;
        }

        void vscode.window.showErrorMessage(`Selected folder is not a Couchbase Lite database: ${formatError(error)}`);
      }
    }),
    vscode.commands.registerCommand("cblite.selectDatabase", (node?: DatabaseNode) => {
      if (!node) {
        return;
      }

      databaseProvider.selectDatabase(node);
    }),
    vscode.commands.registerCommand("cblite.closeDatabase", (node?: OpenedDatabase) => {
      if (!node) {
        return;
      }

      databaseProvider.closeDatabase(node);
    }),
    vscode.commands.registerCommand("cblite.reloadDatabase", async (node?: OpenedDatabase) => {
      const databasePath = node?.databasePath ?? databaseProvider.activeDatabase?.databasePath;
      if (!databasePath) {
        void vscode.window.showInformationMessage("Open or select a Couchbase Lite database first.");
        return;
      }

      databaseProvider.reloadDatabase(databasePath);
      await revealDefaultCollection(databasePath);
    }),
    vscode.commands.registerCommand("cblite.upgradeDatabase", async (node?: OpenedDatabase | UpgradeNode) => {
      const databasePath = node?.databasePath ?? databaseProvider.activeDatabase?.databasePath;
      if (!databasePath) {
        void vscode.window.showInformationMessage("Open or select a Couchbase Lite database first.");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        "Upgrade this database for the current cblite/LiteCore version? This may make it unreadable by earlier versions.",
        { modal: true },
        "Upgrade Database"
      );
      if (confirmed !== "Upgrade Database") {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Upgrading Couchbase Lite database",
            cancellable: false
          },
          () => databaseProvider.upgradeDatabase(databasePath)
        );
        void vscode.window.showInformationMessage("Database upgraded.");
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    }),
    vscode.commands.registerCommand("cblite.setDatabaseCblitePath", async (node?: OpenedDatabase | CBLitePathNode) => {
      const databasePath = node?.databasePath ?? databaseProvider.activeDatabase?.databasePath;
      if (!databasePath) {
        void vscode.window.showInformationMessage("Open or select a Couchbase Lite database first.");
        return;
      }

      const option = await pickCbliteDownloadOption(downloader);
      if (!option) {
        return;
      }

      try {
        const executablePath = await downloader.installDownloadOption(option);
        await databaseProvider.setDatabaseCblitePath(databasePath, executablePath);
        void vscode.window.showInformationMessage(`Using ${option.releaseName} for ${getDatabaseLabel(databasePath)}.`);
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    }),
    vscode.commands.registerCommand("cblite.clearDatabaseCblitePath", async (node?: OpenedDatabase) => {
      const databasePath = node?.databasePath ?? databaseProvider.activeDatabase?.databasePath;
      if (!databasePath) {
        void vscode.window.showInformationMessage("Open or select a Couchbase Lite database first.");
        return;
      }

      await databaseProvider.clearDatabaseCblitePath(databasePath);
      void vscode.window.showInformationMessage(`Using default cblite for ${getDatabaseLabel(databasePath)}.`);
    }),
    vscode.commands.registerCommand("cblite.refreshMetadata", async () => {
      await metadataProvider.refresh();
    }),
    vscode.commands.registerCommand("cblite.searchDocuments", async () => {
      const pattern = await vscode.window.showInputBox({
        title: "Search Couchbase Lite Documents",
        prompt: "Search document IDs across all opened databases. Plain text is treated as a prefix, e.g. user becomes user*.",
        placeHolder: "Document ID or pattern"
      });
      if (!pattern) {
        return;
      }

      try {
        const databasesWithMatches = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Searching for ${pattern}`,
            cancellable: false
          },
          () => databaseProvider.searchDocuments(pattern)
        );

        for (const database of databasesWithMatches) {
          await databaseTreeView.reveal(database, { expand: 2, focus: false, select: false });
        }
      } catch (error) {
        void vscode.window.showErrorMessage(formatError(error));
      }
    }),
    vscode.commands.registerCommand("cblite.loadMoreDocuments", async (node) => {
      await databaseProvider.loadMoreDocuments(node);
    }),
    vscode.commands.registerCommand("cblite.copyDocumentId", async (node?: DocumentNode) => {
      if (!node?.documentId) {
        void vscode.window.showInformationMessage("Select a Couchbase Lite document first.");
        return;
      }

      await vscode.env.clipboard.writeText(node.documentId);
      void vscode.window.showInformationMessage(`Copied document ID: ${node.documentId}`);
    }),
    vscode.commands.registerCommand("cblite.deleteDocument", async (node?: DocumentNode) => {
      const target = node ?? editor.getActiveDocument();
      if (!target) {
        void vscode.window.showInformationMessage("Open or select a Couchbase Lite document first.");
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `Delete document "${target.documentId}"? This cannot be undone.`,
        { modal: true },
        "Delete"
      );
      if (confirmed !== "Delete") {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deleting ${target.documentId}`,
          cancellable: false
        },
        () => cli.deleteDocument(target.databasePath, target.documentId, target.collectionName)
      );

      databaseProvider.forgetDocument(target);
      if ("uri" in target) {
        await editor.closeDocument(target.uri);
      }

      void vscode.window.showInformationMessage(`Deleted ${target.documentId}`);
    }),
    vscode.commands.registerCommand("cblite.openDocument", async (node?: DocumentNode) => {
      const target = node ?? (await pickDocumentId(databaseProvider.activeDatabase?.databasePath));
      if (!target) {
        return;
      }

      await editor.open(target.databasePath, target.documentId, target.collectionName);
    })
  );

  databaseProvider.emitActiveDatabase();

  async function revealDefaultCollection(databasePath: string): Promise<void> {
    try {
      const defaultCollection = await databaseProvider.getDefaultCollectionNode(databasePath);
      if (defaultCollection) {
        await databaseTreeView.reveal(defaultCollection, { expand: true, focus: false, select: false });
      }
    } catch {
      // Opening should not fail just because the default collection is absent.
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deactivate(): void {
  // VS Code disposes registered subscriptions for us.
}

async function pickDatabasePath(): Promise<string | undefined> {
  const result = await vscode.window.showOpenDialog({
    title: "Open Couchbase Lite Database",
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Open Database"
  });

  return result?.[0]?.fsPath;
}

async function pickCbliteDownloadOption(downloader: CBLiteDownloader): Promise<CBLiteDownloadOption | undefined> {
  const options = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading cblite versions",
      cancellable: false
    },
    () => downloader.listDownloadOptions()
  );

  if (options.length === 0) {
    void vscode.window.showWarningMessage("No cblite downloads are available for this platform.");
    return undefined;
  }

  const items = options.map((option) => ({
    label: option.releaseName,
    description: `${option.assetName}${option.prerelease ? " • prerelease" : ""}`,
    detail: `${option.compatibility}${option.publishedAt ? `\nPublished ${new Date(option.publishedAt).toLocaleDateString()}` : ""}`,
    option
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Choose cblite Version",
    placeHolder: "Select a Couchbase Mobile Tools release for this database",
    matchOnDescription: true,
    matchOnDetail: true
  });

  return selected?.option;
}

function getDatabaseLabel(databasePath: string): string {
  return databasePath.split(/[\\/]/).filter(Boolean).pop() ?? databasePath;
}

async function pickDocumentId(databasePath: string | undefined): Promise<DocumentNode | undefined> {
  if (!databasePath) {
    void vscode.window.showInformationMessage("Open a Couchbase Lite database first.");
    return undefined;
  }

  const documentId = await vscode.window.showInputBox({
    title: "Open Couchbase Lite Document",
    prompt: "Enter the document ID to view or edit"
  });

  if (!documentId) {
    return undefined;
  }

  return {
    type: "document",
    databasePath,
    collectionName: "_default._default",
    documentId
  };
}
