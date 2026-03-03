import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { ClaudeProcess, DashboardData } from "./types.js";

const execFileAsync = promisify(execFile);

function encodeProjectDir(projectDir: string): string {
  // ~/.claude/projects encodes paths by replacing / with -
  return projectDir.replace(/\//g, "-");
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

        if (!modelName && entry.type === "assistant" && entry.message?.model) {
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

function parseElapsedSeconds(etime: string): number {
  // etime format: [[DD-]HH:]MM:SS
  const parts = etime.trim().split(/[-:]/);
  let seconds = 0;
  if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 3) {
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  } else if (parts.length === 4) {
    seconds = parseInt(parts[0]) * 86400 + parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
  }
  return seconds;
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
    try {
      const { stdout: branchOut } = await execFileAsync(
        "git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"],
        { timeout: 2000 }
      );
      gitBranch = branchOut.trim() || null;
    } catch { /* not a git repo or git not available */ }

    return { projectDir, openFiles, currentTask, gitBranch, modelName };
  } catch {
    return { projectDir: "", openFiles: [], currentTask: null };
  }
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

      // Check if this is an MCP bridge process
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
        modelName: extra.modelName ?? null,
        isMcpBridge,
      } satisfies ClaudeProcess;
    })
  );

  const visible = enriched.filter(p => !p.isMcpBridge);

  const totalWorking = visible.filter(p => p.status === "working").length;
  const totalIdle = visible.filter(p => p.status === "idle").length;

  return {
    processes: visible,
    collectedAt: new Date().toISOString(),
    totalWorking,
    totalIdle,
  };
}
