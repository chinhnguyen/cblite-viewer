import * as vscode from "vscode";
import { CBLiteCli } from "./cbliteCli";
import { CBLiteDownloader } from "./cbliteDownloader";
import { DatabaseNode, DatabaseTreeProvider, DocumentNode, OpenedDatabase } from "./databaseTree";
import { DocumentEditor } from "./documentEditor";
import { MetadataTreeProvider } from "./metadataTree";

export function activate(context: vscode.ExtensionContext): void {
  const downloader = new CBLiteDownloader(context);
  const cli = new CBLiteCli(downloader);
  const databaseProvider = new DatabaseTreeProvider(context, cli);
  const metadataProvider = new MetadataTreeProvider(cli);
  const editor = new DocumentEditor(context, cli);

  context.subscriptions.push(
    editor,
    databaseProvider.onDidChangeActiveDatabase(async (database) => {
      await metadataProvider.setDatabase(database?.databasePath);
    }),
    vscode.window.registerTreeDataProvider("cbliteDatabases", databaseProvider),
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
    vscode.commands.registerCommand("cblite.refreshMetadata", async () => {
      await metadataProvider.refresh();
    }),
    vscode.commands.registerCommand("cblite.loadMoreDocuments", async (node) => {
      await databaseProvider.loadMoreDocuments(node);
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
