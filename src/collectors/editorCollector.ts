import { readFile } from "fs/promises";
import { execFileAsync } from "../utils/execUtils.js";
import { EditorWindow } from "../types.js";
import { parseStorageFolders } from "../utils/processUtils.js";
import { EDITOR_CONFIGS } from "../editorConfig.js";


async function getRunningBundleIds(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e", 'tell application "System Events" to get bundle identifier of every process',
    ]);
    return new Set(stdout.split(", ").map(s => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function collectEditorWindows(): Promise<EditorWindow[]> {
  const results: EditorWindow[] = [];

  const runningIds = await getRunningBundleIds();
  for (const { app, globalStoragePath, bundleId } of EDITOR_CONFIGS) {
    if (!runningIds.has(bundleId)) continue;
    if (!globalStoragePath) continue;

    try {
      const content = await readFile(globalStoragePath, "utf-8");
      const storage = JSON.parse(content) as {
        backupWorkspaces?: { folders?: Array<{ folderUri: string }> };
      };
      results.push(...parseStorageFolders(storage, app as EditorWindow["app"]));
    } catch {
      continue;
    }
  }

  return results;
}
