import express, { Request, Response } from "express";
import path from "path";
import os from "os";
import { watch } from "fs";
import { collectProcesses } from "./processCollector.js";
import { focusVSCodeWindow, openWorktreeInVSCode } from "./vscodeController.js";
import { DashboardData } from "./types.js";

const app = express();
const PORT = process.env.PORT ?? 3000;
const DEBUG = process.env.BYAKUGAN_DEBUG === "true";

function dbg(...args: unknown[]) {
  if (DEBUG) console.log(`[${new Date().toISOString()}]`, ...args);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

if (DEBUG) {
  app.use((req, _res, next) => {
    dbg(`→ ${req.method} ${req.path}`);
    next();
  });
}

// BYAKUGAN_POLL_INTERVAL でSSE更新間隔とプロセスデータキャッシュTTLを変更できる（デフォルト: 2秒）
const POLL_INTERVAL_MS = parseInt(process.env.BYAKUGAN_POLL_INTERVAL ?? "2") * 1000;

let cache: { data: DashboardData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = POLL_INTERVAL_MS;

async function getProcessData(): Promise<DashboardData> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    dbg("cache hit");
    return cache.data;
  }
  const t0 = Date.now();
  const data = await collectProcesses();
  dbg(`collectProcesses: ${Date.now() - t0}ms, procs=${data.processes.length}, editors=${data.editorWindows.length}`);
  cache = { data, fetchedAt: now };
  return data;
}

// SSE clients registry
const sseClients = new Set<Response>();

function broadcastReload() {
  for (const res of sseClients) {
    res.write("event: reload\ndata: {}\n\n");
  }
}

// Watch public/ for hot reload
const publicDir = path.join(__dirname, "..", "public");
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
watch(publicDir, { recursive: true }, () => {
  // Debounce: wait 50ms to avoid duplicate events
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log("[hot-reload] public/ changed — reloading clients");
    broadcastReload();
  }, 50);
});

// Client configuration (homeDir etc.)
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({ homeDir: os.homedir() });
});

// REST snapshot
app.get("/api/processes", async (_req: Request, res: Response) => {
  try {
    const data = await getProcessData();
    res.json(data);
  } catch (err) {
    console.error("Failed to collect processes:", err);
    res.status(500).json({ error: "Failed to collect processes" });
  }
});

// Focus VSCode window
app.post("/api/focus", async (req: Request, res: Response) => {
  const { pid } = req.body as { pid?: number };
  if (!pid) {
    res.status(400).json({ error: "pid is required" });
    return;
  }
  const data = await getProcessData();
  const proc = data.processes.find(p => p.pid === pid);
  if (!proc) {
    res.status(404).json({ error: "Process not found" });
    return;
  }
  // Respond immediately, focus in background
  res.json({ success: true });
  focusVSCodeWindow(proc.projectDir, proc.editorApp ?? "vscode").catch(() => {});
});

// Focus editor window (no Claude process)
app.post("/api/focus-editor", async (req: Request, res: Response) => {
  const { projectDir, app: editorApp } = req.body as { projectDir?: string; app?: string };
  if (!projectDir) {
    res.status(400).json({ error: "projectDir is required" });
    return;
  }
  // Respond immediately, focus in background
  res.json({ success: true });
  focusVSCodeWindow(projectDir, editorApp === "cursor" ? "cursor" : "vscode").catch(() => {});
});

// Open worktree in VSCode via extension
app.post("/api/open-worktree", async (req: Request, res: Response) => {
  const { path: worktreePath, newWindow } = req.body as { path?: string; newWindow?: boolean };
  if (!worktreePath) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const success = await openWorktreeInVSCode(worktreePath, newWindow);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(502).json({ success: false, error: "VSCode extension not reachable" });
  }
});

// SSE stream
app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  dbg(`SSE client connected (total: ${sseClients.size})`);

  const sendData = async () => {
    try {
      const data = await getProcessData();
      res.write(`event: processes\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error("SSE error:", err);
    }
  };

  sendData();
  const interval = setInterval(sendData, POLL_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(interval);
    sseClients.delete(res);
    dbg(`SSE client disconnected (total: ${sseClients.size})`);
  });
});

app.listen(PORT, () => {
  console.log(`byakugan running at http://localhost:${PORT}`);
});
