export function encodeProjectDir(projectDir: string): string {
  // ~/.claude/projects encodes paths by replacing all non-alphanumeric characters with -
  return projectDir.replace(/[^a-zA-Z0-9]/g, "-");
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

interface StorageFolder {
  app: "vscode" | "cursor" | "ghostty";
  projectDir: string;
  projectName: string;
  gitBranch: string | null;
  gitCommonDir: string | null;
  prUrl: string | null;
  prTitle: string | null;
}

export function parseStorageFolders(
  storage: { backupWorkspaces?: { folders?: Array<{ folderUri: string }> } },
  app: "vscode" | "cursor" | "ghostty"
): StorageFolder[] {
  const folders = storage.backupWorkspaces?.folders ?? [];
  const results: StorageFolder[] = [];
  for (const { folderUri } of folders) {
    if (!folderUri.startsWith("file://")) continue;
    const projectDir = decodeURIComponent(folderUri.replace("file://", "")).replace(/\/$/, "");
    if (!projectDir) continue;
    const projectName = projectDir.split("/").pop() ?? projectDir;
    results.push({ app, projectDir, projectName, gitBranch: null, gitCommonDir: null, prUrl: null, prTitle: null });
  }
  return results;
}
