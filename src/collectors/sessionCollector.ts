import { readdir, readFile, stat } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import os from "os";
import https from "https";
import { execSync } from "child_process";
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

function getOAuthToken(): string | null {
  // macOS Keychain
  if (process.platform === "darwin") {
    try {
      const result = execSync(
        '/usr/bin/security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: "utf-8", timeout: 2000 }
      ).trim();
      if (result) {
        const parsed = JSON.parse(result);
        const creds = parsed.claudeAiOauth ?? parsed;
        if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now())) {
          return creds.accessToken;
        }
      }
    } catch { /* ignore */ }
  }
  // File fallback
  try {
    const content = readFileSync(path.join(os.homedir(), ".claude/.credentials.json"), "utf-8");
    const parsed = JSON.parse(content);
    const creds = parsed.claudeAiOauth ?? parsed;
    if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now())) {
      return creds.accessToken;
    }
  } catch { /* ignore */ }
  return null;
}

type OAuthUsageResult = {
  fiveHourPercent: number;
  weeklyPercent: number;
  fiveHourResetsAt: string | null;
  weeklyResetsAt: string | null;
};

type OAuthUsageResponse =
  | { ok: true; data: OAuthUsageResult }
  | { ok: false; error: 'auth' | 'ratelimit' | 'other' };

// Module-level cache for OAuth usage results
let oauthCache: {
  result: OAuthUsageResult | null;
  error: 'auth' | 'ratelimit' | 'other' | null;
  fetchedAt: number;
} | null = null;

const CACHE_TTL_SUCCESS_MS = 30 * 1000;
const CACHE_TTL_FAILURE_MS = 15 * 1000;

function fetchOAuthUsage(accessToken: string): Promise<OAuthUsageResponse> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/api/oauth/usage",
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const clamp = (v: number | undefined) =>
              v == null || !isFinite(v) ? 0 : Math.max(0, Math.min(100, v));
            resolve({
              ok: true,
              data: {
                fiveHourPercent: clamp(parsed.five_hour?.utilization),
                weeklyPercent: clamp(parsed.seven_day?.utilization),
                fiveHourResetsAt: parsed.five_hour?.resets_at ?? null,
                weeklyResetsAt: parsed.seven_day?.resets_at ?? null,
              },
            });
          } catch { resolve({ ok: false, error: 'other' }); }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ ok: false, error: 'auth' });
        } else if (res.statusCode === 429) {
          resolve({ ok: false, error: 'ratelimit' });
        } else {
          resolve({ ok: false, error: 'other' });
        }
      });
    });
    req.on("error", () => resolve({ ok: false, error: 'other' }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: 'other' }); });
    req.end();
  });
}

async function collectSessionTokens(): Promise<{
  fiveHourTokens: number;
  weeklyTokens: number;
}> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const now = Date.now();
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let fiveHourTokens = 0;
  let weeklyTokens = 0;

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
            const tokens = (usage.output_tokens ?? 0);
            weeklyTokens += tokens;
            if (ts >= fiveHoursAgo) fiveHourTokens += tokens;
          } catch { /* skip malformed lines */ }
        }
      } catch { /* skip inaccessible files */ }
    }));
  }));

  return { fiveHourTokens, weeklyTokens };
}

async function getCachedOAuthUsage(): Promise<OAuthUsageResponse | null> {
  const now = Date.now();

  if (oauthCache) {
    const age = now - oauthCache.fetchedAt;
    if (oauthCache.result !== null) {
      // Successful cache
      if (age < CACHE_TTL_SUCCESS_MS) {
        return { ok: true, data: oauthCache.result };
      }
    } else if (oauthCache.error === 'auth') {
      // Auth errors are never cached — fall through to fetch
    } else if (oauthCache.error !== null) {
      // ratelimit / other: cache for failure TTL
      if (age < CACHE_TTL_FAILURE_MS) {
        return { ok: false, error: oauthCache.error };
      }
    }
  }

  const token = getOAuthToken();
  if (!token) return null;

  const response = await fetchOAuthUsage(token);

  if (response.ok) {
    oauthCache = { result: response.data, error: null, fetchedAt: now };
  } else if (response.error === 'auth') {
    // Do not cache auth errors
    oauthCache = null;
  } else {
    oauthCache = { result: null, error: response.error, fetchedAt: now };
  }

  return response;
}

export async function collectRateLimitUsage(): Promise<{
  fiveHourTokens: number;
  weeklyTokens: number;
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
  fiveHourResetsAt: string | null;
  weeklyResetsAt: string | null;
  authError: boolean;
}> {
  const [tokenData, apiResponse] = await Promise.all([
    collectSessionTokens().catch(() => ({ fiveHourTokens: 0, weeklyTokens: 0 })),
    getCachedOAuthUsage(),
  ]);

  const apiData = apiResponse?.ok ? apiResponse.data : null;
  const authError = apiResponse !== null && !apiResponse.ok && apiResponse.error === 'auth';

  return {
    fiveHourTokens: tokenData.fiveHourTokens,
    weeklyTokens: tokenData.weeklyTokens,
    fiveHourPercent: apiData?.fiveHourPercent ?? null,
    weeklyPercent: apiData?.weeklyPercent ?? null,
    fiveHourResetsAt: apiData?.fiveHourResetsAt ?? null,
    weeklyResetsAt: apiData?.weeklyResetsAt ?? null,
    authError,
  };
}
