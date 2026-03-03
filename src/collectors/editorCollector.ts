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
