import { ClaudeProcess, DashboardData, UsageData } from "./types.js";
import { execFileAsync } from "./utils/execUtils.js";
import { parseElapsedSeconds } from "./utils/processUtils.js";
import { collectSessionData, collectRateLimitUsage } from "./collectors/sessionCollector.js";
import { collectGitInfo } from "./collectors/gitCollector.js";
import { collectDockerContainers } from "./collectors/dockerCollector.js";
import { collectEditorWindows } from "./collectors/editorCollector.js";

const MCP_BRIDGE_PATHS = ["/mcp", "mcp-server", "mcp_server", ".mcp"];

async function enrichProcess(pid: number): Promise<Partial<ClaudeProcess> & { inputTokens: number; outputTokens: number }> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-p", String(pid)], { maxBuffer: 10 * 1024 * 1024 });
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

    const [{ currentTask: sessionTask, modelName, inputTokens, outputTokens, claudeStatus }, containers, { gitBranch, gitCommonDir, prUrl, prTitle }] = await Promise.all([
      collectSessionData(projectDir),
      collectDockerContainers(projectDir),
      collectGitInfo(projectDir),
    ]);
    const currentTask = sessionTask ?? openFiles[0] ?? null;

    return { projectDir, openFiles, currentTask, gitBranch, gitCommonDir, modelName, prUrl, prTitle, containers, inputTokens, outputTokens, claudeStatus };
  } catch {
    return { projectDir: "", openFiles: [], currentTask: null, inputTokens: 0, outputTokens: 0, claudeStatus: null };
  }
}

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
            editorApp: null,
            isMcpBridge,
            containers: extra.containers ?? [],
          } satisfies ClaudeProcess,
          inputTokens: extra.inputTokens,
          outputTokens: extra.outputTokens,
        };
      })
    ),
    collectRateLimitUsage(),
  ]);

  const enriched = enrichedWithTokens.map(e => e.process);
  const totalInputTokens = enrichedWithTokens.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = enrichedWithTokens.reduce((sum, e) => sum + e.outputTokens, 0);

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
  const filteredEditorWindows = allEditorWindows.filter(w => {
    if (claudeDirs.has(w.projectDir)) return false;
    if (seenEditorDirs.has(w.projectDir)) return false;
    seenEditorDirs.add(w.projectDir);
    return true;
  });

  const editorWindows = await Promise.all(
    filteredEditorWindows.map(async w => {
      const git = await collectGitInfo(w.projectDir);
      return { ...w, ...git };
    })
  );

  const usage: UsageData = {
    totalInputTokens,
    totalOutputTokens,
    ...rateLimitUsage,
  };

  return {
    processes: visible,
    editorWindows,
    collectedAt: new Date().toISOString(),
    totalWorking,
    totalIdle,
    usage,
  };
}
