import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { ClaudeProcess, DashboardData, EditorWindow } from "./types.js";

const execFileAsync = promisify(execFile);

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

async function readSessionData(projectDir: string): Promise<{ currentTask: string | null; modelName: string | null }> {
  try {
    const encoded = encodeProjectDir(projectDir);
    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects", encoded);

    const files = await readdir(claudeProjectsDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return { currentTask: null, modelName: null };

    // Find most recently modified JSONL file
    const stats = await Promise.all(
      jsonlFiles.map(async f => ({ f, mtime: (await stat(path.join(claudeProjectsDir, f))).mtime }))
    );
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latestFile = path.join(claudeProjectsDir, stats[0].f);

    const content = await readFile(latestFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let currentTask: string | null = null;
    let modelName: string | null = null;

    // Scan from end to find last user text message and model name
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);

        if (!modelName && entry.message?.model) {
          modelName = entry.message.model;
        }

        if (!currentTask && entry.type === "user") {
          const msgContent = entry.message?.content;
          if (typeof msgContent === "string" && msgContent.trim()) {
            currentTask = msgContent.slice(0, 120);
          } else if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if (item?.type === "text" && item.text?.trim()) {
                const text = item.text.trim();
                if (text.startsWith("<") || text.startsWith("Caveat:")) continue;
                currentTask = text.slice(0, 120);
                break;
              }
            }
          }
        }

        if (currentTask && modelName) break;
      } catch {
        // skip malformed lines
      }
    }
    return { currentTask, modelName };
  } catch {
    return { currentTask: null, modelName: null };
  }
}

async function enrichProcess(pid: number): Promise<Partial<ClaudeProcess>> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-p", String(pid)], { maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.split("\n");

    const cwdLine = lines.find(l => / cwd /.test(l));
    const projectDir = cwdLine?.trim().split(/\s+/).pop() ?? null;

    if (!projectDir) {
      return { projectDir: "", openFiles: [], currentTask: null };
    }

    const openFiles = lines
      .filter(l => / REG /.test(l))
      .map(l => l.trim().split(/\s+/).pop() ?? "")
      .filter(p =>
        p.startsWith(projectDir) &&
        !/(\/\.git\/|\/\.claude\/|\/node_modules\/)/.test(p) &&
        /\.(ts|js|tsx|jsx|rb|go|py|php|json|md|yaml|toml|css|html|rs|c|cpp)$/.test(p)
      )
      .map(p => p.replace(projectDir + "/", ""))
      .filter((v, i, a) => a.indexOf(v) === i);

    const { currentTask: sessionTask, modelName } = await readSessionData(projectDir);
    const currentTask = sessionTask ?? openFiles[0] ?? null;

    let gitBranch: string | null = null;
    let gitCommonDir: string | null = null;
    try {
      const [{ stdout: branchOut }, { stdout: commonDirOut }] = await Promise.all([
        execFileAsync("git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }),
        execFileAsync("git", ["-C", projectDir, "rev-parse", "--git-common-dir"], { timeout: 2000 }),
      ]);
      gitBranch = branchOut.trim() || null;
      const rawCommonDir = commonDirOut.trim();
      // --git-common-dir returns relative path like ".git" for the main worktree
      gitCommonDir = rawCommonDir.startsWith("/")
        ? rawCommonDir
        : path.resolve(projectDir, rawCommonDir);
    } catch { /* not a git repo or git not available */ }

    return { projectDir, openFiles, currentTask, gitBranch, gitCommonDir, modelName };
  } catch {
    return { projectDir: "", openFiles: [], currentTask: null };
  }
}

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

async function collectEditorWindows(): Promise<EditorWindow[]> {
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

const MCP_BRIDGE_PATHS = ["/mcp", "mcp-server", "mcp_server", ".mcp"];

export async function collectProcesses(): Promise<DashboardData> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid,ppid,pcpu,pmem,etime,stat,comm"]);
  const lines = stdout.trim().split("\n").slice(1);

  const claudeProcesses: Array<{
    pid: number;
    ppid: number;
    cpuPercent: number;
    memPercent: number;
    elapsedTime: string;
    stat: string;
    comm: string;
  }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const [pidStr, ppidStr, cpuStr, memStr, etime, stat, ...commParts] = parts;
    const comm = commParts.join(" ");
    if (comm === "claude") {
      claudeProcesses.push({
        pid: parseInt(pidStr),
        ppid: parseInt(ppidStr),
        cpuPercent: parseFloat(cpuStr),
        memPercent: parseFloat(memStr),
        elapsedTime: etime,
        stat,
        comm,
      });
    }
  }

  const enriched = await Promise.all(
    claudeProcesses.map(async (proc) => {
      const extra = await enrichProcess(proc.pid);
      const projectDir = extra.projectDir ?? "";
      const projectName = projectDir ? projectDir.split("/").pop() ?? projectDir : String(proc.pid);

      const isMcpBridge = MCP_BRIDGE_PATHS.some(p => projectDir.includes(p));
      const cpuPercent = proc.cpuPercent;
      const status: "working" | "idle" = cpuPercent > 5 ? "working" : "idle";

      return {
        pid: proc.pid,
        projectName,
        projectDir,
        cpuPercent,
        memPercent: proc.memPercent,
        status,
        stat: proc.stat,
        elapsedTime: proc.elapsedTime,
        elapsedSeconds: parseElapsedSeconds(proc.elapsedTime),
        currentTask: extra.currentTask ?? null,
        openFiles: extra.openFiles ?? [],
        gitBranch: extra.gitBranch ?? null,
        gitCommonDir: extra.gitCommonDir ?? null,
        modelName: extra.modelName ?? null,
        editorApp: null,
        isMcpBridge,
      } satisfies ClaudeProcess;
    })
  );

  const nonBridge = enriched.filter(p => !p.isMcpBridge);

  const allEditorWindows = await collectEditorWindows();
  const editorDirMap = new Map(allEditorWindows.map(w => [w.projectDir, w.app]));

  const visible = nonBridge.map(p => ({
    ...p,
    editorApp: editorDirMap.get(p.projectDir) ?? null,
  }));

  const totalWorking = visible.filter(p => p.status === "working").length;
  const totalIdle = visible.filter(p => p.status === "idle").length;

  // Editor windows without a Claude process
  const claudeDirs = new Set(visible.map(p => p.projectDir));
  const seenEditorDirs = new Set<string>();
  const editorWindows = allEditorWindows.filter(w => {
    if (claudeDirs.has(w.projectDir)) return false;
    if (seenEditorDirs.has(w.projectDir)) return false;
    seenEditorDirs.add(w.projectDir);
    return true;
  });

  return {
    processes: visible,
    editorWindows,
    collectedAt: new Date().toISOString(),
    totalWorking,
    totalIdle,
  };
}
