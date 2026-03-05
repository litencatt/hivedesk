import express, { Request, Response } from "express";
import path from "path";
import { watch } from "fs";
import { collectProcesses } from "./processCollector.js";
import { focusVSCodeWindow } from "./vscodeController.js";
import { DashboardData } from "./types.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Cache with 2-second TTL
let cache: { data: DashboardData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 2000;

async function getProcessData(): Promise<DashboardData> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await collectProcesses();
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

// SSE stream
app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);

  const sendData = async () => {
    try {
      const data = await getProcessData();
      res.write(`event: processes\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error("SSE error:", err);
    }
  };

  sendData();
  const interval = setInterval(sendData, 2000);

  req.on("close", () => {
    clearInterval(interval);
    sseClients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`byakugan running at http://localhost:${PORT}`);
});
