import { readdir, readFile, stat } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import os from "os";
import https from "https";
import { execSync } from "child_process";
import { encodeProjectDir } from "../utils/processUtils.js";

export async function collectSessionData(projectDir: string): Promise<{ currentTask: string | null; modelName: string | null; inputTokens: number; outputTokens: number; claudeStatus: "thinking" | "tool_use" | "executing" | "waiting" | null }> {
  try {
    const encoded = encodeProjectDir(projectDir);
    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects", encoded);

    const files = await readdir(claudeProjectsDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return { currentTask: null, modelName: null, inputTokens: 0, outputTokens: 0, claudeStatus: null };

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

    // Third pass: determine claudeStatus from last meaningful entry
    const SKIP_TYPES = new Set(["file-history-snapshot", "queue-operation", "last-prompt", "pr-link"]);
    let claudeStatus: "thinking" | "tool_use" | "executing" | "waiting" | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (SKIP_TYPES.has(entry.type)) continue;
        if (entry.type === "progress") {
          claudeStatus = "executing";
        } else if (entry.type === "assistant") {
          const content: Array<{ type: string }> = entry.message?.content ?? [];
          const hasThinking = Array.isArray(content) && content.some((c) => c.type === "thinking");
          const stopReason: string | null = entry.message?.stop_reason ?? null;
          if (hasThinking && !stopReason) {
            claudeStatus = "thinking";
          } else if (stopReason === "tool_use") {
            claudeStatus = "tool_use";
          } else if (stopReason === "end_turn") {
            claudeStatus = "waiting";
          }
        } else if (entry.type === "user") {
          // user entry at end means Claude hasn't responded yet
          claudeStatus = null;
        }
        break;
      } catch {
        // skip malformed lines
      }
    }

    return { currentTask, modelName, inputTokens, outputTokens, claudeStatus };
  } catch {
    return { currentTask: null, modelName: null, inputTokens: 0, outputTokens: 0, claudeStatus: null };
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
  | { ok: false; error: 'auth' | 'ratelimit' | 'other'; retryAfterMs?: number };

// Module-level cache for OAuth usage results
let oauthCache: {
  result: OAuthUsageResult | null;
  error: 'auth' | 'ratelimit' | 'other' | null;
  fetchedAt: number;
  consecutiveFailures: number;
  retryAfterMs: number | null;
} | null = null;

const CACHE_TTL_SUCCESS_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_FAILURE_BASE_MS = 15 * 1000;
const CACHE_TTL_FAILURE_MAX_MS = 60 * 60 * 1000; // 1 hour cap

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
          const retryAfter = res.headers['retry-after'];
          let retryAfterMs: number | undefined;
          if (retryAfter) {
            const secs = parseInt(String(retryAfter), 10);
            if (!isNaN(secs)) {
              retryAfterMs = secs * 1000;
            } else {
              const date = new Date(retryAfter).getTime();
              if (!isNaN(date)) retryAfterMs = Math.max(0, date - Date.now());
            }
          }
          resolve({ ok: false, error: 'ratelimit', retryAfterMs });
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
  fiveHourResetsAt: string | null;
}> {
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
            const tokens = (usage.output_tokens ?? 0);
            weeklyTokens += tokens;
            if (ts >= fiveHoursAgo) {
              fiveHourTokens += tokens;
              if (oldestFiveHourTs === null || ts < oldestFiveHourTs) oldestFiveHourTs = ts;
            }
          } catch { /* skip malformed lines */ }
        }
      } catch { /* skip inaccessible files */ }
    }));
  }));

  // Claudeの5時間制限はスライディングウィンドウ方式（固定時刻区切りではない）。
  // リセット時刻 = 窓内の最古エントリのタイムスタンプ + 5時間。
  // そのためリセット時刻はキリの良い時間にならない。
  // 例: 09:05 に最初のトークンを使った場合 → 14:05 にその分の制限が解放される
  const fiveHourResetsAt = oldestFiveHourTs
    ? new Date(oldestFiveHourTs + 5 * 60 * 60 * 1000).toISOString()
    : null;

  return { fiveHourTokens, weeklyTokens, fiveHourResetsAt };
}

// Set to false to temporarily disable OAuth usage API calls (e.g. during persistent 429)
// Set back to true to re-enable; stale failure cache is cleared automatically on re-enable.
let oauthFetchEnabled = false;
let _prevOauthFetchEnabled = false;

async function getCachedOAuthUsage(): Promise<OAuthUsageResponse | null> {
  if (!oauthFetchEnabled) {
    _prevOauthFetchEnabled = false;
    return null;
  }
  // Clear stale failure cache when re-enabling
  if (!_prevOauthFetchEnabled) {
    oauthCache = null;
    _prevOauthFetchEnabled = true;
  }

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
      // Use Retry-After if available and > 0, otherwise exponential backoff
      const backoff = (oauthCache.retryAfterMs !== null && oauthCache.retryAfterMs > 0)
        ? oauthCache.retryAfterMs
        : Math.min(
            CACHE_TTL_FAILURE_BASE_MS * Math.pow(2, oauthCache.consecutiveFailures - 1),
            CACHE_TTL_FAILURE_MAX_MS
          );
      if (age < backoff) {
        return { ok: false, error: oauthCache.error };
      }
    }
  }

  const token = getOAuthToken();
  if (!token) return null;

  const response = await fetchOAuthUsage(token);

  if (response.ok) {
    oauthCache = { result: response.data, error: null, fetchedAt: now, consecutiveFailures: 0, retryAfterMs: null };
  } else if (response.error === 'auth') {
    // Do not cache auth errors
    oauthCache = null;
  } else {
    const prev = oauthCache?.consecutiveFailures ?? 0;
    const retryAfterMs = response.retryAfterMs ?? null;
    oauthCache = { result: null, error: response.error, fetchedAt: now, consecutiveFailures: prev + 1, retryAfterMs };
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
    collectSessionTokens().catch(() => ({ fiveHourTokens: 0, weeklyTokens: 0, fiveHourResetsAt: null })),
    getCachedOAuthUsage(),
  ]);

  const apiData = apiResponse?.ok ? apiResponse.data : null;
  const authError = apiResponse !== null && !apiResponse.ok && apiResponse.error === 'auth';

  // Fallback approximate % when OAuth unavailable (env-configured limits only)
  const fiveHourLimit = process.env.BYAKUGAN_5H_LIMIT ? parseInt(process.env.BYAKUGAN_5H_LIMIT) : null;
  const weeklyLimit = process.env.BYAKUGAN_WEEKLY_LIMIT ? parseInt(process.env.BYAKUGAN_WEEKLY_LIMIT) : null;
  const fallbackFiveHourPercent = !apiData && fiveHourLimit && tokenData.fiveHourTokens > 0
    ? Math.min(100, Math.round((tokenData.fiveHourTokens / fiveHourLimit) * 100))
    : null;
  const fallbackWeeklyPercent = !apiData && weeklyLimit && tokenData.weeklyTokens > 0
    ? Math.min(100, Math.round((tokenData.weeklyTokens / weeklyLimit) * 100))
    : null;

  return {
    fiveHourTokens: tokenData.fiveHourTokens,
    weeklyTokens: tokenData.weeklyTokens,
    fiveHourPercent: apiData?.fiveHourPercent ?? fallbackFiveHourPercent,
    weeklyPercent: apiData?.weeklyPercent ?? fallbackWeeklyPercent,
    fiveHourResetsAt: apiData?.fiveHourResetsAt ?? tokenData.fiveHourResetsAt,
    weeklyResetsAt: apiData?.weeklyResetsAt ?? null,
    authError,
  };
}
