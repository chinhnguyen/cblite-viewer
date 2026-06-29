import * as vscode from "vscode";
import { CBLiteCli } from "./cbliteCli";
import { CBLiteDownloader } from "./cbliteDownloader";
import { DatabaseNode, DatabaseTreeProvider, DocumentNode, OpenedDatabase, UpgradeNode } from "./databaseTree";
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

      databaseProvider.openDatabase(databasePath);
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
