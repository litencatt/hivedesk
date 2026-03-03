import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
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

const EDITOR_APP_NAMES: Record<EditorWindow["app"], string> = {
  vscode: "Code",
  cursor: "Cursor",
};

export async function getFocusedEditorDir(knownWindows: EditorWindow[]): Promise<string | null> {
  try {
    const script = `
      tell application "System Events"
        set frontApp to name of first process whose frontmost is true
        set winTitle to ""
        try
          set winTitle to name of front window of first process whose frontmost is true
        end try
        return frontApp & "|" & winTitle
      end tell
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 2000 });
    const [appName, windowTitle] = stdout.trim().split("|");

    const matchedApp = (Object.entries(EDITOR_APP_NAMES) as [EditorWindow["app"], string][])
      .find(([, name]) => name === appName)?.[0];
    if (!matchedApp || !windowTitle) return null;

    // Window title format: "filename — project-name — App" or "project-name — App"
    const segments = windowTitle.split(" \u2014 ");
    const candidates = segments.slice(0, -1); // remove trailing app name segment

    for (const candidate of candidates.reverse()) {
      const match = knownWindows.find(
        w => w.app === matchedApp && (w.projectName === candidate.trim() || w.projectDir.endsWith("/" + candidate.trim()))
      );
      if (match) return match.projectDir;
    }
    return null;
  } catch {
    return null;
  }
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
