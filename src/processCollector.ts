import { DashboardData, UsageData, Worktree } from "./types.js";
import { execFileAsync } from "./utils/execUtils.js";
import { parseElapsedSeconds } from "./utils/processUtils.js";
import { collectSessionData, collectRateLimitUsage } from "./collectors/sessionCollector.js";
import { collectGitInfo } from "./collectors/gitCollector.js";
import { collectDockerContainers } from "./collectors/dockerCollector.js";
import { collectEditorWindows } from "./collectors/editorCollector.js";
import { EDITOR_CONFIGS } from "./editorConfig.js";

const MCP_BRIDGE_PATHS = ["/mcp", "mcp-server", "mcp_server", ".mcp"];

// BYAKUGAN_DOCKER=false の場合のみDocker Compose連携を無効化（デフォルト: 有効）
const DOCKER_ENABLED = process.env.BYAKUGAN_DOCKER !== "false";

// BYAKUGAN_PROCESS_NAMES でモニタリング対象のプロセス名を変更できる（カンマ区切り、デフォルト: "claude"）
const MONITORED_PROCESS_NAMES = new Set(
  (process.env.BYAKUGAN_PROCESS_NAMES ?? "claude").split(",").map(s => s.trim()).filter(Boolean)
);

const DEBUG = process.env.BYAKUGAN_DEBUG === "true";
function dbg(phase: string, ms: number, extra = "") {
  if (DEBUG) console.log(`[collector] ${phase}: ${ms}ms${extra ? " " + extra : ""}`);
}

function findEditorApp(
  pid: number,
  procMap: Map<number, { ppid: number; command: string }>
): "vscode" | "cursor" | "ghostty" | null {
  let current = pid;
  const visited = new Set<number>();
  while (current > 1 && !visited.has(current)) {
    visited.add(current);
    const proc = procMap.get(current);
    if (!proc) break;
    for (const config of EDITOR_CONFIGS) {
      if (config.processPattern.test(proc.command)) return config.app;
    }
    current = proc.ppid;
  }
  return null;
}

interface EditorDetectionResult {
  editorApp: "vscode" | "cursor" | "ghostty" | null;
  tmuxSocket: string | null;
  tmuxSession: string | null;
}

async function detectEditorFromEnv(
  pid: number,
  allProcMap: Map<number, { ppid: number; command: string }>
): Promise<EditorDetectionResult> {
  try {
    const { stdout } = await execFileAsync("ps", ["ewww", "-p", String(pid)]);
    const termProgram = stdout.match(/TERM_PROGRAM=(\S+)/)?.[1];
    if (termProgram === "ghostty") return { editorApp: "ghostty", tmuxSocket: null, tmuxSession: null };
    if (termProgram === "vscode") return { editorApp: "vscode", tmuxSocket: null, tmuxSession: null };
    if (termProgram === "cursor") return { editorApp: "cursor", tmuxSocket: null, tmuxSession: null };

    // tmux内の場合: TMUXソケットからクライアントPIDを取得し、そのプロセスツリーを辿る
    const tmuxSocket = stdout.match(/TMUX=([^,\s]+)/)?.[1];
    const tmuxPane = stdout.match(/TMUX_PANE=(\S+)/)?.[1];
    if (tmuxSocket) {
      let editorApp: "vscode" | "cursor" | "ghostty" | null = null;
      const { stdout: clientOut } = await execFileAsync("tmux", [
        "-S", tmuxSocket, "list-clients", "-F", "#{client_pid}",
      ]);
      for (const line of clientOut.trim().split("\n")) {
        const clientPid = parseInt(line);
        if (!isNaN(clientPid)) {
          const app = findEditorApp(clientPid, allProcMap);
          if (app) { editorApp = app; break; }
        }
      }

      let tmuxSession: string | null = null;
      if (tmuxPane) {
        try {
          const { stdout: sessionOut } = await execFileAsync("tmux", [
            "-S", tmuxSocket, "display-message", "-p", "-t", tmuxPane, "#{session_name}:#{window_index}",
          ]);
          tmuxSession = sessionOut.trim() || null;
        } catch {}
      }

      return { editorApp, tmuxSocket, tmuxSession };
    }
  } catch {}
  return { editorApp: null, tmuxSocket: null, tmuxSession: null };
}

interface EnrichedProcess {
  pid: number;
  projectName: string;
  projectDir: string;
  cpuPercent: number;
  memPercent: number;
  status: "working" | "idle";
  claudeStatus: "thinking" | "tool_use" | "executing" | "waiting" | null;
  stat: string;
  elapsedTime: string;
  elapsedSeconds: number;
  currentTask: string | null;
  openFiles: string[];
  gitBranch: string | null;
  gitCommonDir: string | null;
  modelName: string | null;
  prUrl: string | null;
  prTitle: string | null;
  editorApp: "vscode" | "cursor" | "ghostty" | null;
  tmuxSocket: string | null;
  tmuxSession: string | null;
  isMcpBridge: boolean;
  containers: import("./types.js").DockerContainer[];
}

async function enrichProcess(pid: number): Promise<Partial<EnrichedProcess> & { inputTokens: number; outputTokens: number }> {
  try {
    let t = Date.now();
    const { stdout } = await execFileAsync("lsof", ["-p", String(pid), "-n", "-P"], { maxBuffer: 10 * 1024 * 1024, timeout: 5000 });
    dbg(`lsof pid=${pid}`, Date.now() - t);

    const lines = stdout.split("\n");
    const cwdLine = lines.find(l => / cwd /.test(l));
    const projectDir = cwdLine?.trim().split(/\s+/).pop() ?? null;

    if (!projectDir) {
      return { projectDir: "", openFiles: [], currentTask: null, inputTokens: 0, outputTokens: 0 };
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

    t = Date.now();
    const [{ currentTask: sessionTask, modelName, inputTokens, outputTokens, claudeStatus }, containers, { gitBranch, gitCommonDir, prUrl, prTitle }] = await Promise.all([
      collectSessionData(projectDir),
      DOCKER_ENABLED ? collectDockerContainers(projectDir) : Promise.resolve([]),
      collectGitInfo(projectDir),
    ]);
    dbg(`session+docker+git pid=${pid}`, Date.now() - t);

    const currentTask = sessionTask ?? openFiles[0] ?? null;
    return { projectDir, openFiles, currentTask, gitBranch, gitCommonDir, modelName, prUrl, prTitle, containers, inputTokens, outputTokens, claudeStatus };
  } catch {
    return { projectDir: "", openFiles: [], currentTask: null, inputTokens: 0, outputTokens: 0, claudeStatus: null };
  }
}

export async function collectProcesses(): Promise<DashboardData> {
  const t0 = Date.now();
  const [{ stdout }, { stdout: psAllOut }] = await Promise.all([
    execFileAsync("ps", ["-eo", "pid,ppid,pcpu,pmem,etime,stat,comm"]),
    execFileAsync("ps", ["-eo", "pid,ppid,command"]),
  ]);
  dbg("ps", Date.now() - t0);
  const lines = stdout.trim().split("\n").slice(1);

  const allProcMap = new Map<number, { ppid: number; command: string }>();
  for (const line of psAllOut.trim().split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = parseInt(parts[0]);
    const ppid = parseInt(parts[1]);
    const command = parts.slice(2).join(" ");
    allProcMap.set(pid, { ppid, command });
  }

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
    if (MONITORED_PROCESS_NAMES.has(comm)) {
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

  const te = Date.now();
  const [enrichedWithTokens, rateLimitUsage] = await Promise.all([
    Promise.all(
      claudeProcesses.map(async (proc) => {
        const extra = await enrichProcess(proc.pid);
        const projectDir = extra.projectDir ?? "";
        const projectName = projectDir ? projectDir.split("/").pop() ?? projectDir : String(proc.pid);

        const isMcpBridge = MCP_BRIDGE_PATHS.some(p => projectDir.includes(p));
        const cpuPercent = proc.cpuPercent;
        const status: "working" | "idle" = cpuPercent > 5 ? "working" : "idle";

        return {
          process: {
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
            prUrl: extra.prUrl ?? null,
            prTitle: extra.prTitle ?? null,
            claudeStatus: extra.claudeStatus ?? null,
            editorApp: null as "vscode" | "cursor" | "ghostty" | null,
            tmuxSocket: null as string | null,
            tmuxSession: null as string | null,
            isMcpBridge,
            containers: extra.containers ?? [],
          } satisfies EnrichedProcess,
          inputTokens: extra.inputTokens,
          outputTokens: extra.outputTokens,
        };
      })
    ),
    collectRateLimitUsage(),
  ]);

  dbg("enrich all processes", Date.now() - te, `(${claudeProcesses.length} procs)`);

  const enriched = enrichedWithTokens.map(e => e.process);
  const totalInputTokens = enrichedWithTokens.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = enrichedWithTokens.reduce((sum, e) => sum + e.outputTokens, 0);

  const nonBridge = enriched.filter(p => !p.isMcpBridge);

  const tw = Date.now();
  const allEditorWindows = await collectEditorWindows();
  dbg("collectEditorWindows", Date.now() - tw);

  const visible = await Promise.all(nonBridge.map(async p => {
    const editorFromTree = findEditorApp(p.pid, allProcMap);
    const { editorApp: editorFromEnv, tmuxSocket, tmuxSession } = await detectEditorFromEnv(p.pid, allProcMap);
    return { ...p, editorApp: editorFromTree ?? editorFromEnv, tmuxSocket, tmuxSession };
  }));

  // Worktree への集約
  const worktreeMap = new Map<string, Worktree>();

  for (const p of visible) {
    const key = p.projectDir || String(p.pid);
    if (!worktreeMap.has(key)) {
      worktreeMap.set(key, {
        projectDir: p.projectDir,
        projectName: p.projectName,
        gitBranch: p.gitBranch ?? null,
        gitCommonDir: p.gitCommonDir ?? null,
        prUrl: p.prUrl ?? null,
        prTitle: p.prTitle ?? null,
        containers: p.containers ?? [],
        terminal: p.editorApp,
        tmuxSocket: p.tmuxSocket ?? null,
        tmuxSession: p.tmuxSession ?? null,
        sessions: [],
      });
    } else {
      const wt = worktreeMap.get(key)!;
      if (!wt.terminal && p.editorApp) wt.terminal = p.editorApp;
      if (!wt.tmuxSocket && p.tmuxSocket) wt.tmuxSocket = p.tmuxSocket;
      if (!wt.tmuxSession && p.tmuxSession) wt.tmuxSession = p.tmuxSession;
    }
    worktreeMap.get(key)!.sessions.push({
      pid: p.pid,
      cpuPercent: p.cpuPercent,
      memPercent: p.memPercent,
      status: p.status,
      claudeStatus: p.claudeStatus ?? null,
      stat: p.stat,
      elapsedTime: p.elapsedTime,
      elapsedSeconds: p.elapsedSeconds,
      currentTask: p.currentTask ?? null,
      openFiles: p.openFiles ?? [],
      modelName: p.modelName ?? null,
      isMcpBridge: p.isMcpBridge,
    });
  }

  // Editor windows (Claudeなし) を追加
  const claudeDirs = new Set(visible.map(p => p.projectDir));
  const seenEditorDirs = new Set<string>();
  for (const w of allEditorWindows) {
    if (claudeDirs.has(w.projectDir)) continue;
    if (seenEditorDirs.has(w.projectDir)) continue;
    seenEditorDirs.add(w.projectDir);

    const git = await collectGitInfo(w.projectDir);
    worktreeMap.set(w.projectDir, {
      projectDir: w.projectDir,
      projectName: w.projectName,
      gitBranch: git.gitBranch ?? w.gitBranch,
      gitCommonDir: git.gitCommonDir ?? w.gitCommonDir,
      prUrl: git.prUrl ?? w.prUrl,
      prTitle: git.prTitle ?? w.prTitle,
      containers: [],
      terminal: w.app,
      tmuxSocket: null,
      tmuxSession: null,
      sessions: [],
    });
  }

  const worktrees = [...worktreeMap.values()];
  const totalWorking = visible.filter(p => p.status === "working").length;
  const totalIdle = visible.filter(p => p.status === "idle").length;

  const usage: UsageData = {
    totalInputTokens,
    totalOutputTokens,
    ...rateLimitUsage,
  };

  return {
    worktrees,
    collectedAt: new Date().toISOString(),
    totalWorking,
    totalIdle,
    usage,
  };
}
