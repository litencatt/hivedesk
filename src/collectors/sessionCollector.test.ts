import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import https from "https";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";

vi.mock("https", () => ({ default: { request: vi.fn() } }));
vi.mock("child_process", () => ({ execSync: vi.fn() }));
vi.mock("fs", () => ({ readFileSync: vi.fn() }));
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { getCachedOAuthUsage, _resetOAuthCacheForTest } from "./sessionCollector.js";

function mockHttpsRequest(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
) {
  vi.mocked(https.request).mockImplementationOnce((_options: any, callback?: Function) => {
    const req = new EventEmitter() as any;
    req.end = vi.fn();
    req.destroy = vi.fn();
    if (callback) {
      const res = new EventEmitter() as any;
      res.statusCode = statusCode;
      res.headers = headers;
      callback(res);
      Promise.resolve().then(() => {
        res.emit("data", body);
        res.emit("end");
      });
    }
    return req;
  });
}

const SUCCESS_BODY = JSON.stringify({
  five_hour: { utilization: 42, resets_at: "2024-01-01T17:00:00Z" },
  seven_day: { utilization: 75, resets_at: "2024-01-08T12:00:00Z" },
});

function mockToken() {
  vi.mocked(execSync).mockReturnValue(
    JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } }) as any
  );
}

function mockNoToken() {
  vi.mocked(execSync).mockImplementation(() => {
    throw new Error("not found");
  });
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("not found");
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
  _resetOAuthCacheForTest();
  vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  mockToken();
  delete process.env.BYAKUGAN_OAUTH_FETCH;
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("getCachedOAuthUsage", () => {
  it("returns null when BYAKUGAN_OAUTH_FETCH=false (no API call)", async () => {
    process.env.BYAKUGAN_OAUTH_FETCH = "false";
    const result = await getCachedOAuthUsage();
    expect(result).toBeNull();
    expect(https.request).not.toHaveBeenCalled();
  });

  it("returns null when token cannot be obtained (no API call)", async () => {
    mockNoToken();
    const result = await getCachedOAuthUsage();
    expect(result).toBeNull();
    expect(https.request).not.toHaveBeenCalled();
  });

  it("caches successful response and does not call API again within TTL", async () => {
    mockHttpsRequest(200, SUCCESS_BODY);
    const first = await getCachedOAuthUsage();
    expect(first).toEqual({
      ok: true,
      data: {
        fiveHourPercent: 42,
        weeklyPercent: 75,
        fiveHourResetsAt: "2024-01-01T17:00:00Z",
        weeklyResetsAt: "2024-01-08T12:00:00Z",
      },
    });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance time within TTL (300s)
    vi.advanceTimersByTime(299_000);
    const second = await getCachedOAuthUsage();
    expect(second).toEqual(first);
    // Should NOT call API again
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after successful cache TTL (300s) expires", async () => {
    mockHttpsRequest(200, SUCCESS_BODY);
    await getCachedOAuthUsage();
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(300_001);

    mockHttpsRequest(200, SUCCESS_BODY);
    const second = await getCachedOAuthUsage();
    expect(second?.ok).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("caches auth error (401) for 5 minutes and does not retry within that period", async () => {
    mockHttpsRequest(401, "Unauthorized");
    const first = await getCachedOAuthUsage();
    expect(first).toEqual({ ok: false, error: "auth" });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance within 5 minutes
    vi.advanceTimersByTime(299_000);
    const second = await getCachedOAuthUsage();
    expect(second).toEqual({ ok: false, error: "auth" });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("retries auth error after 5-minute cache expires", async () => {
    mockHttpsRequest(401, "Unauthorized");
    await getCachedOAuthUsage();
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance past 5 minutes
    vi.advanceTimersByTime(300_001);

    mockHttpsRequest(200, SUCCESS_BODY);
    const result = await getCachedOAuthUsage();
    expect(result?.ok).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("uses Retry-After header value for rate limit (429) backoff", async () => {
    mockHttpsRequest(429, "Too Many Requests", { "retry-after": "120" });
    const first = await getCachedOAuthUsage();
    expect(first).toEqual({ ok: false, error: "ratelimit", retryAfterMs: 120_000 });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance within Retry-After period (120s)
    vi.advanceTimersByTime(119_000);
    const second = await getCachedOAuthUsage();
    expect(second).toEqual({ ok: false, error: "ratelimit" });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance past Retry-After
    vi.advanceTimersByTime(2_000);
    mockHttpsRequest(200, SUCCESS_BODY);
    const third = await getCachedOAuthUsage();
    expect(third?.ok).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff for rate limit (429) without Retry-After", async () => {
    // First failure: backoff = 10min * 2^0 = 10min = 600_000ms
    mockHttpsRequest(429, "Too Many Requests");
    const first = await getCachedOAuthUsage();
    expect(first).toEqual({ ok: false, error: "ratelimit", retryAfterMs: undefined });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Within 10 minutes: should not retry
    vi.advanceTimersByTime(599_000);
    const second = await getCachedOAuthUsage();
    expect(second).toEqual({ ok: false, error: "ratelimit" });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Past 10 minutes: should retry
    vi.advanceTimersByTime(2_000);
    mockHttpsRequest(200, SUCCESS_BODY);
    const third = await getCachedOAuthUsage();
    expect(third?.ok).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff for other errors", async () => {
    // First failure: backoff = 10min * 2^0 = 600_000ms
    mockHttpsRequest(500, "Internal Server Error");
    const first = await getCachedOAuthUsage();
    expect(first).toEqual({ ok: false, error: "other" });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Within backoff: should not retry
    vi.advanceTimersByTime(599_000);
    const second = await getCachedOAuthUsage();
    expect(second).toEqual({ ok: false, error: "other" });
    expect(https.request).toHaveBeenCalledTimes(1);

    // Past backoff: should retry
    vi.advanceTimersByTime(2_000);
    mockHttpsRequest(200, SUCCESS_BODY);
    const third = await getCachedOAuthUsage();
    expect(third?.ok).toBe(true);
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls issue only one HTTP request (in-flight deduplication)", async () => {
    mockToken();
    mockHttpsRequest(200, SUCCESS_BODY);

    // Fire two concurrent calls without awaiting in between
    const [r1, r2] = await Promise.all([getCachedOAuthUsage(), getCachedOAuthUsage()]);

    // Both callers should receive the same successful response
    expect(r1?.ok).toBe(true);
    expect(r2?.ok).toBe(true);

    // Only one HTTP request should have been made
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("concurrent error calls issue only one HTTP request and all callers receive the error", async () => {
    mockToken();
    mockHttpsRequest(429, "Too Many Requests");

    const [r1, r2, r3] = await Promise.all([
      getCachedOAuthUsage(),
      getCachedOAuthUsage(),
      getCachedOAuthUsage(),
    ]);

    expect(r1).toEqual({ ok: false, error: "ratelimit", retryAfterMs: undefined });
    expect(r2).toEqual({ ok: false, error: "ratelimit", retryAfterMs: undefined });
    expect(r3).toEqual({ ok: false, error: "ratelimit", retryAfterMs: undefined });

    // Only one HTTP request despite three concurrent callers
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  it("after in-flight promise resolves, a new call past TTL issues a fresh request", async () => {
    mockToken();
    mockHttpsRequest(200, SUCCESS_BODY);

    await Promise.all([getCachedOAuthUsage(), getCachedOAuthUsage()]);
    expect(https.request).toHaveBeenCalledTimes(1);

    // Advance past TTL (300s)
    vi.advanceTimersByTime(301_000);
    mockHttpsRequest(200, SUCCESS_BODY);
    await getCachedOAuthUsage();

    // A second API call should occur after TTL expires
    expect(https.request).toHaveBeenCalledTimes(2);
  });

  it("restores from disk cache when in-memory cache is missing (tsx watch restart)", async () => {
    const diskCache = {
      result: {
        fiveHourPercent: 55,
        weeklyPercent: 80,
        fiveHourResetsAt: "2024-01-01T17:00:00Z",
        weeklyResetsAt: "2024-01-08T12:00:00Z",
      },
      error: null,
      fetchedAt: Date.now() - 60_000, // fetched 60s ago, within TTL
      consecutiveFailures: 0,
      retryAfterMs: null,
    };
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(diskCache) as any);

    // In-memory cache is already cleared by _resetOAuthCacheForTest()
    const result = await getCachedOAuthUsage();
    expect(result).toEqual({ ok: true, data: diskCache.result });
    // No API call should have been made
    expect(https.request).not.toHaveBeenCalled();
  });
});
