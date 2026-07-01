import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as path from "node:path";
import AdmZip from "adm-zip";
import * as tar from "tar";
import * as vscode from "vscode";

const LATEST_RELEASE_URL = "https://api.github.com/repos/couchbaselabs/couchbase-mobile-tools/releases/latest";
const RELEASES_URL = "https://api.github.com/repos/couchbaselabs/couchbase-mobile-tools/releases?per_page=50";

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export interface CBLiteDownloadOption {
  releaseTag: string;
  releaseName: string;
  releaseUrl: string;
  prerelease: boolean;
  publishedAt: string | undefined;
  liteCoreVersion: string | undefined;
  compatibility: string;
  assetName: string;
  assetUrl: string;
  archiveType: "zip" | "tar.gz" | "binary";
}

export class CBLiteDownloader {
  private executablePromise: Promise<string> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async getExecutablePath(): Promise<string> {
    this.executablePromise ??= this.resolveExecutablePath();
    return this.executablePromise;
  }

  async listDownloadOptions(): Promise<CBLiteDownloadOption[]> {
    const releases = await getJson<GitHubRelease[]>(RELEASES_URL);
    return releases
      .map((release) => {
        const asset = selectAsset(release.assets, false);
        return asset ? createDownloadOption(release, asset) : undefined;
      })
      .filter((option): option is CBLiteDownloadOption => Boolean(option));
  }

  async installDownloadOption(option: CBLiteDownloadOption): Promise<string> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${option.releaseName}`,
        cancellable: false
      },
      async (progress) => this.installAsset(option, progress)
    );
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
        const asset = selectAsset(release.assets, true);
        return this.installAsset(createDownloadOption(release, asset), progress);
      }
    );
  }

  private async installAsset(option: CBLiteDownloadOption, progress: vscode.Progress<{ message?: string }>): Promise<string> {
    const installDir = path.join(this.context.globalStorageUri.fsPath, "cblite", sanitizePathSegment(option.releaseTag), sanitizePathSegment(option.assetName));
    const executableName = process.platform === "win32" ? "cblite.exe" : "cblite";
    const markerPath = path.join(installDir, ".cblite-path");

    const installedExecutable = await readInstalledExecutable(markerPath, installDir);
    if (installedExecutable && (await canRunCblite(installedExecutable))) {
      return installedExecutable;
    }

    await fs.rm(installDir, { recursive: true, force: true });
    await fs.mkdir(installDir, { recursive: true });

    progress.report({ message: `Downloading ${option.assetName}...` });
    const assetPath = path.join(installDir, option.assetName);
    await downloadFile(option.assetUrl, assetPath);

    if (option.archiveType === "zip") {
      progress.report({ message: "Extracting cblite..." });
      const zip = new AdmZip(assetPath);
      zip.extractAllTo(installDir, true);
      await fs.rm(assetPath, { force: true });
    } else if (option.archiveType === "tar.gz") {
      progress.report({ message: "Extracting cblite..." });
      await tar.x({ file: assetPath, cwd: installDir });
      await fs.rm(assetPath, { force: true });
    } else {
      const directExecutablePath = path.join(installDir, executableName);
      if (path.basename(assetPath) !== executableName) {
        await fs.rename(assetPath, directExecutablePath);
      }
    }

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
}

function canRunCblite(executablePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(executablePath, ["--version"], { timeout: 10_000 }, (error) => {
      resolve(!error);
    });
  });
}

function selectAsset(assets: GitHubAsset[], required: true): GitHubAsset;
function selectAsset(assets: GitHubAsset[], required: false): GitHubAsset | undefined;
function selectAsset(assets: GitHubAsset[], required: boolean): GitHubAsset | undefined {
  const platformName = getAssetPlatformName();
  const candidates = getAssetArchCandidates();
  const asset = candidates
    .flatMap((arch) => getAssetNameCandidates(platformName, arch))
    .map((candidate) => assets.find((item) => assetMatches(item.name, candidate)))
    .find((item): item is GitHubAsset => Boolean(item));

  if (!asset && required) {
    throw new Error(`No cblite download is available for ${process.platform}/${process.arch}.`);
  }

  return asset;
}

function createDownloadOption(release: GitHubRelease, asset: GitHubAsset): CBLiteDownloadOption {
  const liteCoreVersion = extractLiteCoreVersion(release.body ?? "");
  return {
    releaseTag: release.tag_name,
    releaseName: release.name ?? release.tag_name,
    releaseUrl: release.html_url,
    prerelease: release.prerelease,
    publishedAt: release.published_at ?? undefined,
    liteCoreVersion,
    compatibility: liteCoreVersion
      ? `Built with Couchbase Lite Core ${liteCoreVersion}. Use for databases readable by LiteCore ${liteCoreVersion}; exact .cblite2 format mapping is not declared in the release metadata.`
      : "Compatibility details are not declared in the release metadata.",
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    archiveType: getArchiveType(asset.name)
  };
}

function getAssetNameCandidates(platformName: string, arch: string): string[] {
  switch (process.platform) {
    case "darwin":
      return [`${platformName}-${arch}.zip`, "cblite", /^cblite-mac-.*\.zip$/i.source];
    case "linux":
      return [`${platformName}-${arch}.zip`, `${platformName}-${arch}.tar.gz`, "cblite.tar.gz", /^cblite-linux-.*\.tar\.gz$/i.source];
    case "win32":
      return [`${platformName}-${arch}.zip`, "cblite.exe", /^cblite-win-.*\.zip$/i.source];
    default:
      return [];
  }
}

function assetMatches(assetName: string, candidate: string): boolean {
  if (candidate.startsWith("^")) {
    return new RegExp(candidate).test(assetName);
  }

  return assetName === candidate;
}

function getArchiveType(assetName: string): CBLiteDownloadOption["archiveType"] {
  if (assetName.endsWith(".zip")) {
    return "zip";
  }

  if (assetName.endsWith(".tar.gz")) {
    return "tar.gz";
  }

  return "binary";
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

function extractLiteCoreVersion(body: string): string | undefined {
  return /Couchbase Lite Core\s+([0-9][^\s.,)]*)/i.exec(body)?.[1] ?? /LiteCore\s+([0-9][^\s.,)]*)/i.exec(body)?.[1];
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
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
