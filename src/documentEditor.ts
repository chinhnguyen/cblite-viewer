import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { CBLiteCli } from "./cbliteCli";

export interface OpenDocument {
  databasePath: string;
  collectionName: string;
  documentId: string;
}

export interface OpenDocumentReference extends OpenDocument {
  uri: vscode.Uri;
}

export class DocumentEditor implements vscode.Disposable {
  private readonly documents = new Map<string, OpenDocument>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cli: CBLiteCli
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => this.save(document)),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateActiveEditorContext())
    );
    this.updateActiveEditorContext();
  }

  async open(databasePath: string, documentId: string, collectionName = "_default._default"): Promise<void> {
    const data = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading ${documentId}`,
        cancellable: false
      },
      () => this.cli.getDocument(databasePath, documentId, collectionName)
    );

    await this.closeReusableCleanDocumentTab();

    const uri = await this.writeEditableFile(databasePath, collectionName, documentId, data);
    this.documents.set(uri.toString(), { databasePath, collectionName, documentId });

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    this.updateActiveEditorContext();
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  getActiveDocument(): OpenDocumentReference | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      return undefined;
    }

    const metadata = this.documents.get(uri.toString());
    return metadata ? { ...metadata, uri } : undefined;
  }

  async closeDocument(uri: vscode.Uri): Promise<void> {
    await this.closeTab(uri);
    this.documents.delete(uri.toString());
    this.updateActiveEditorContext();
  }

  private async save(document: vscode.TextDocument): Promise<void> {
    const metadata = this.documents.get(document.uri.toString());
    if (!metadata) {
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(document.getText());
    } catch (error) {
      void vscode.window.showErrorMessage(`Invalid JSON. Document was not saved to Couchbase Lite: ${formatError(error)}`);
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Saving ${metadata.documentId}`,
          cancellable: false
        },
        () => this.cli.putDocument(metadata.databasePath, metadata.documentId, json, metadata.collectionName)
      );
      void vscode.window.showInformationMessage(`Saved ${metadata.documentId}`);
    } catch (error) {
      void vscode.window.showErrorMessage(formatError(error));
    }
  }

  private async writeEditableFile(databasePath: string, collectionName: string, documentId: string, data: unknown): Promise<vscode.Uri> {
    const databaseHash = crypto.createHash("sha1").update(databasePath).digest("hex").slice(0, 12);
    const collectionHash = crypto.createHash("sha1").update(collectionName).digest("hex").slice(0, 12);
    const storageUri = vscode.Uri.joinPath(this.context.globalStorageUri, "documents", databaseHash, collectionHash);
    await vscode.workspace.fs.createDirectory(storageUri);

    const fileName = `${sanitizeFileName(documentId)}.json`;
    const uri = vscode.Uri.file(path.join(storageUri.fsPath, fileName));
    const content = `${JSON.stringify(data, null, 2)}\n`;

    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    return uri;
  }

  private async closeReusableCleanDocumentTab(): Promise<void> {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && this.documents.has(activeDocument.uri.toString()) && !activeDocument.isDirty) {
      await this.closeTab(activeDocument.uri);
      this.documents.delete(activeDocument.uri.toString());
      this.updateActiveEditorContext();
      return;
    }

    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const uri = getTextTabUri(tab);
        if (!uri || !this.documents.has(uri.toString()) || tab.isDirty) {
          continue;
        }

        await vscode.window.tabGroups.close(tab);
        this.documents.delete(uri.toString());
        this.updateActiveEditorContext();
        return;
      }
    }
  }

  private async closeTab(uri: vscode.Uri): Promise<void> {
    for (const tabGroup of vscode.window.tabGroups.all) {
      const tab = tabGroup.tabs.find((candidate) => getTextTabUri(candidate)?.toString() === uri.toString());
      if (tab) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }

  private updateActiveEditorContext(): void {
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    void vscode.commands.executeCommand("setContext", "cblite.documentEditorActive", Boolean(activeUri && this.documents.has(activeUri)));
  }
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 80 ? sanitized.slice(0, 80) : sanitized || "document";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getTextTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  return tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined;
}
