import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { encodeProjectDir } from "../utils/processUtils.js";

export async function readSessionData(projectDir: string): Promise<{ currentTask: string | null; modelName: string | null; inputTokens: number; outputTokens: number }> {
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
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
  fiveHourResetsAt: string | null;
  weeklyResetsAt: string | null;
}> {
  try {
    const usageCachePath = path.join(os.homedir(), ".claude/plugins/oh-my-claudecode/.usage-cache.json");
    const content = await readFile(usageCachePath, "utf-8");
    const cache = JSON.parse(content);
    if (cache.error || !cache.data) return { fiveHourPercent: null, weeklyPercent: null, fiveHourResetsAt: null, weeklyResetsAt: null };
    const { fiveHourPercent, weeklyPercent, fiveHourResetsAt, weeklyResetsAt } = cache.data;
    return {
      fiveHourPercent: fiveHourPercent ?? null,
      weeklyPercent: weeklyPercent ?? null,
      fiveHourResetsAt: fiveHourResetsAt ?? null,
      weeklyResetsAt: weeklyResetsAt ?? null,
    };
  } catch {
    return { fiveHourPercent: null, weeklyPercent: null, fiveHourResetsAt: null, weeklyResetsAt: null };
  }
}
