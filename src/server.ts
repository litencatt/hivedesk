import express, { Request, Response } from "express";
import path from "path";
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
  try {
    const data = await getProcessData();
    const proc = data.processes.find(p => p.pid === pid);
    if (!proc) {
      res.status(404).json({ error: "Process not found" });
      return;
    }
    const success = await focusVSCodeWindow(proc.projectDir);
    res.json({ success });
  } catch (err) {
    console.error("Failed to focus window:", err);
    res.status(500).json({ error: "Failed to focus window" });
  }
});

// SSE stream
app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

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
  });
});

app.listen(PORT, () => {
  console.log(`claudes-watch running at http://localhost:${PORT}`);
});
