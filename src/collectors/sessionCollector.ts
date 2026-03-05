import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { encodeProjectDir } from "../utils/processUtils.js";

export async function collectSessionData(projectDir: string): Promise<{ currentTask: string | null; modelName: string | null; inputTokens: number; outputTokens: number }> {
  try {
    const encoded = encodeProjectDir(projectDir);
    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects", encoded);

    const files = await readdir(claudeProjectsDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return { currentTask: null, modelName: null, inputTokens: 0, outputTokens: 0 };

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
    let inputTokens = 0;
    let outputTokens = 0;

    // First pass: scan all lines to accumulate tokens
    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);

        if (entry.type === "assistant" && entry.message?.usage) {
          inputTokens += entry.message.usage.input_tokens ?? 0;
          outputTokens += entry.message.usage.output_tokens ?? 0;
        }
      } catch {
        // skip malformed lines
      }
    }

    // Second pass: scan from end to find last user text message and model name
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
    return { currentTask, modelName, inputTokens, outputTokens };
  } catch {
    return { currentTask: null, modelName: null, inputTokens: 0, outputTokens: 0 };
  }
}

export async function collectRateLimitUsage(): Promise<{
  fiveHourTokens: number;
  weeklyTokens: number;
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
  fiveHourResetsAt: string | null;
}> {
  try {
    const projectsDir = path.join(os.homedir(), ".claude", "projects");
    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let fiveHourTokens = 0;
    let weeklyTokens = 0;
    let oldestFiveHourTs: number | null = null;

    const projects = await readdir(projectsDir).catch(() => [] as string[]);

    await Promise.all(projects.map(async (project) => {
      const projectPath = path.join(projectsDir, project);
      const files = await readdir(projectPath).catch(() => [] as string[]);
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));

      await Promise.all(jsonlFiles.map(async (file) => {
        const filePath = path.join(projectPath, file);
        try {
          const fileStat = await stat(filePath);
          if (fileStat.mtime.getTime() < weekAgo) return;

          const content = await readFile(filePath, "utf-8");
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;

              const ts = new Date(entry.timestamp).getTime();
              if (ts < weekAgo) continue;

              const usage = entry.message.usage;
              const tokens =
                (usage.input_tokens ?? 0) +
                (usage.output_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0);

              weeklyTokens += tokens;
              if (ts >= fiveHoursAgo) {
                fiveHourTokens += tokens;
                if (oldestFiveHourTs === null || ts < oldestFiveHourTs) {
                  oldestFiveHourTs = ts;
                }
              }
            } catch { /* skip malformed lines */ }
          }
        } catch { /* skip inaccessible files */ }
      }));
    }));

    const fiveHourResetsAt = oldestFiveHourTs
      ? new Date(oldestFiveHourTs + 5 * 60 * 60 * 1000).toISOString()
      : null;

    const fiveHourLimit = parseInt(process.env.BYAKUGAN_5H_LIMIT ?? "1000000");
    const weeklyLimit = parseInt(process.env.BYAKUGAN_WEEKLY_LIMIT ?? "5000000");
    const fiveHourPercent = Math.min(100, Math.round((fiveHourTokens / fiveHourLimit) * 100));
    const weeklyPercent = Math.min(100, Math.round((weeklyTokens / weeklyLimit) * 100));

    return { fiveHourTokens, weeklyTokens, fiveHourPercent, weeklyPercent, fiveHourResetsAt };
  } catch {
    return { fiveHourTokens: 0, weeklyTokens: 0, fiveHourPercent: null, weeklyPercent: null, fiveHourResetsAt: null };
  }
}
