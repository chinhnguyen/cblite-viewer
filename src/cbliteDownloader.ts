import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as path from "node:path";
import AdmZip from "adm-zip";
import * as vscode from "vscode";

const LATEST_RELEASE_URL = "https://api.github.com/repos/couchbaselabs/couchbase-mobile-tools/releases/latest";

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export class CBLiteDownloader {
  private executablePromise: Promise<string> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async getExecutablePath(): Promise<string> {
    this.executablePromise ??= this.resolveExecutablePath();
    return this.executablePromise;
  }

  private async resolveExecutablePath(): Promise<string> {
    const configuredPath = vscode.workspace.getConfiguration("cbliteViewer").get<string>("cblitePath", "cblite");
    if (await canRunCblite(configuredPath)) {
      return configuredPath;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Downloading cblite CLI",
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: "Finding latest Couchbase Mobile Tools release..." });
        const release = await getJson<GitHubRelease>(LATEST_RELEASE_URL);
        const asset = selectAsset(release.assets);

        const installDir = path.join(this.context.globalStorageUri.fsPath, "cblite", release.tag_name);
        const executableName = process.platform === "win32" ? "cblite.exe" : "cblite";
        const markerPath = path.join(installDir, ".cblite-path");

        const installedExecutable = await readInstalledExecutable(markerPath, installDir);
        if (installedExecutable && (await canRunCblite(installedExecutable))) {
          return installedExecutable;
        }

        await fs.rm(installDir, { recursive: true, force: true });
        await fs.mkdir(installDir, { recursive: true });

        progress.report({ message: `Downloading ${asset.name}...` });
        const zipPath = path.join(installDir, asset.name);
        await downloadFile(asset.browser_download_url, zipPath);

        progress.report({ message: "Extracting cblite..." });
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(installDir, true);
        await fs.rm(zipPath, { force: true });

        const extractedExecutable = await findExecutable(installDir, executableName);
        if (process.platform !== "win32") {
          await fs.chmod(extractedExecutable, 0o755);
        }

        if (!(await canRunCblite(extractedExecutable))) {
          throw new Error("Downloaded cblite CLI could not be executed.");
        }

        await fs.writeFile(markerPath, path.relative(installDir, extractedExecutable), "utf8");
        return extractedExecutable;
      }
    );
  }
}

function canRunCblite(executablePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(executablePath, ["--version"], { timeout: 10_000 }, (error) => {
      resolve(!error);
    });
  });
}

function selectAsset(assets: GitHubAsset[]): GitHubAsset {
  const platformName = getAssetPlatformName();
  const candidates = getAssetArchCandidates();
  const asset = candidates
    .map((arch) => assets.find((item) => item.name === `${platformName}-${arch}.zip`))
    .find((item): item is GitHubAsset => Boolean(item));

  if (!asset) {
    throw new Error(`No cblite download is available for ${process.platform}/${process.arch}.`);
  }

  return asset;
}

function getAssetPlatformName(): string {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported platform: ${process.platform}.`);
  }
}

function getAssetArchCandidates(): string[] {
  if (process.arch === "x64") {
    return ["x86_64"];
  }

  // Couchbase currently publishes macOS x86_64 builds. On Apple Silicon this
  // can still work when Rosetta is installed.
  if (process.platform === "darwin" && process.arch === "arm64") {
    return ["arm64", "aarch64", "x86_64"];
  }

  if (process.arch === "arm64") {
    return ["arm64", "aarch64"];
  }

  throw new Error(`Unsupported architecture: ${process.arch}.`);
}

function getJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "cblite-vscode" } }, (response) => {
        if (isRedirect(response.statusCode)) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error("GitHub returned a redirect without a location."));
            return;
          }
          getJson<T>(location).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`GitHub request failed with HTTP ${response.statusCode}.`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url: string, destinationPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "cblite-vscode" } }, (response) => {
        if (isRedirect(response.statusCode)) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error("Download redirected without a location."));
            return;
          }
          downloadFile(location, destinationPath).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
          return;
        }

        const file = fsSync.createWriteStream(destinationPath);
        response.pipe(file);
        file.on("finish", () => file.close((error) => (error ? reject(error) : resolve())));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function findExecutable(directoryPath: string, executableName: string): Promise<string> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === executableName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      try {
        return await findExecutable(entryPath, executableName);
      } catch {
        // Keep looking in sibling directories.
      }
    }
  }

  throw new Error(`Downloaded archive did not contain ${executableName}.`);
}

function isRedirect(statusCode: number | undefined): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function readInstalledExecutable(markerPath: string, installDir: string): Promise<string | undefined> {
  try {
    const relativePath = await fs.readFile(markerPath, "utf8");
    return path.join(installDir, relativePath.trim());
  } catch {
    return undefined;
  }
}
