import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { EditorWindow } from "../types.js";
import { parseStorageFolders } from "../utils/processUtils.js";

const execFileAsync = promisify(execFile);

const EDITOR_CONFIGS: Array<{ app: EditorWindow["app"]; globalStoragePath: string; processPattern: RegExp }> = [
  {
    app: "vscode",
    globalStoragePath: path.join(os.homedir(), "Library/Application Support/Code/User/globalStorage/storage.json"),
    processPattern: /Visual Studio Code\.app\/Contents\/MacOS\//,
  },
  {
    app: "cursor",
    globalStoragePath: path.join(os.homedir(), "Library/Application Support/Cursor/User/globalStorage/storage.json"),
    processPattern: /Cursor\.app\/Contents\/MacOS\/Cursor/,
  },
];

const EDITOR_BUNDLE_IDS: Record<EditorWindow["app"], string> = {
  vscode: "com.microsoft.VSCode",
  cursor: "com.todesktop.230313mzl4w4u92",
};

const WORKSPACE_STORAGE_PATHS: Record<EditorWindow["app"], string> = {
  vscode: path.join(os.homedir(), "Library/Application Support/Code/User/workspaceStorage"),
  cursor: path.join(os.homedir(), "Library/Application Support/Cursor/User/workspaceStorage"),
};

async function getFocusedEditorApp(): Promise<EditorWindow["app"] | null> {
  try {
    const script = `
      tell application "System Events"
        set frontBundle to bundle identifier of first process whose frontmost is true
        return frontBundle
      end tell
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 2000 });
    const bundleId = stdout.trim();
    const entry = (Object.entries(EDITOR_BUNDLE_IDS) as [EditorWindow["app"], string][])
      .find(([, id]) => id === bundleId);
    return entry?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getMostRecentWorkspaceDir(app: EditorWindow["app"]): Promise<string | null> {
  try {
    const storageRoot = WORKSPACE_STORAGE_PATHS[app];
    const entries = await readdir(storageRoot);
    const stats = await Promise.all(
      entries.map(async e => ({ name: e, mtime: (await stat(path.join(storageRoot, e))).mtime }))
    );
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const { name } of stats) {
      const wsJson = path.join(storageRoot, name, "workspace.json");
      try {
        const content = await readFile(wsJson, "utf-8");
        const { folder } = JSON.parse(content);
        if (folder?.startsWith("file://")) {
          return decodeURIComponent(folder.replace("file://", "")).replace(/\/$/, "");
        }
      } catch { /* skip */ }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getFocusedEditorDir(_knownWindows: EditorWindow[]): Promise<string | null> {
  const app = await getFocusedEditorApp();
  if (!app) return null;
  return getMostRecentWorkspaceDir(app);
}

export async function collectEditorWindows(): Promise<EditorWindow[]> {
  const results: EditorWindow[] = [];

  // Single ps call for all editor checks
  let psOutput = "";
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "command"]);
    psOutput = stdout;
  } catch {
    return results;
  }
  const psLines = psOutput.split("\n");

  for (const { app, globalStoragePath, processPattern } of EDITOR_CONFIGS) {
    if (!psLines.some(line => processPattern.test(line))) continue;

    try {
      const content = await readFile(globalStoragePath, "utf-8");
      const storage = JSON.parse(content) as {
        backupWorkspaces?: { folders?: Array<{ folderUri: string }> };
      };
      results.push(...parseStorageFolders(storage, app));
    } catch {
      continue;
    }
  }

  return results;
}
