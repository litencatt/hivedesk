import { EditorWindow } from "../types.js";

export function encodeProjectDir(projectDir: string): string {
  // ~/.claude/projects encodes paths by replacing / with -
  return projectDir.replace(/\//g, "-");
}

export function parseElapsedSeconds(etime: string): number {
  // etime format: [[DD-]HH:]MM:SS
  const parts = etime.trim().split(/[-:]/);
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  } else if (parts.length === 4) {
    return parseInt(parts[0]) * 86400 + parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
  }
  return 0;
}

export function parseStorageFolders(
  storage: { backupWorkspaces?: { folders?: Array<{ folderUri: string }> } },
  app: EditorWindow["app"]
): EditorWindow[] {
  const folders = storage.backupWorkspaces?.folders ?? [];
  const results: EditorWindow[] = [];
  for (const { folderUri } of folders) {
    if (!folderUri.startsWith("file://")) continue;
    const projectDir = decodeURIComponent(folderUri.replace("file://", "")).replace(/\/$/, "");
    if (!projectDir) continue;
    const projectName = projectDir.split("/").pop() ?? projectDir;
    results.push({ app, projectDir, projectName });
  }
  return results;
}
