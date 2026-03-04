import { readFile } from "fs/promises";
import { execFileAsync } from "../utils/execUtils.js";
import { EditorWindow } from "../types.js";
import { parseStorageFolders } from "../utils/processUtils.js";
import { EDITOR_CONFIGS } from "../editorConfig.js";


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
