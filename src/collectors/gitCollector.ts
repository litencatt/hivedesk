import path from "path";
import { stat } from "fs/promises";
import { execFileAsync } from "../utils/execUtils.js";

type GitInfo = { gitBranch: string | null; gitCommonDir: string | null; prUrl: string | null; prTitle: string | null };

type BranchCache = {
  data: GitInfo;
  lastBranch: string | null;
  lastFetchHeadMtime: number | null;
  lastRemoteRefMtime: number | null;
  cachedAt: number;
};

// Per-repo PR cache: gitCommonDir → all open PRs keyed by headRefName
type RepoPrCache = {
  prs: Map<string, { url: string; title: string }>;
  fetchHeadMtime: number | null;
  cachedAt: number;
};

const branchCache = new Map<string, BranchCache>();
const repoPrCache = new Map<string, RepoPrCache>();

async function getFileMtime(filePath: string): Promise<number | null> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch { return null; }
}

// Fetch all open PRs for a repo in one gh call, keyed by branch name
async function fetchRepoPrs(repoDir: string): Promise<Map<string, { url: string; title: string }>> {
  const map = new Map<string, { url: string; title: string }>();
  try {
    const { stdout } = await execFileAsync(
      "gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "url,title,headRefName"],
      { cwd: repoDir, timeout: 8000 }
    );
    const prs = JSON.parse(stdout) as Array<{ url: string; title: string; headRefName: string }>;
    for (const pr of prs) {
      if (pr.headRefName) map.set(pr.headRefName, { url: pr.url, title: pr.title });
    }
  } catch { /* gh not available or no PRs */ }
  return map;
}

async function getRepoPrCache(gitCommonDir: string, fetchHeadMtime: number | null): Promise<RepoPrCache> {
  const cached = repoPrCache.get(gitCommonDir);
  const fetchHeadChanged = fetchHeadMtime !== null && fetchHeadMtime !== cached?.fetchHeadMtime;
  // Retry every 5 min as fallback for GitHub-only events (PR created without local git op)
  const cacheExpired = cached && (Date.now() - cached.cachedAt) > 180_000;

  if (cached && !fetchHeadChanged && !cacheExpired) {
    return cached;
  }

  const prs = await fetchRepoPrs(gitCommonDir);
  const entry: RepoPrCache = { prs, fetchHeadMtime, cachedAt: Date.now() };
  repoPrCache.set(gitCommonDir, entry);
  return entry;
}

export async function collectGitInfo(projectDir: string): Promise<GitInfo> {
  // Always get branch (fast local operation)
  let gitBranch: string | null = null;
  let gitCommonDir: string | null = null;
  try {
    const [{ stdout: branchOut }, { stdout: commonDirOut }] = await Promise.all([
      execFileAsync("git", ["-C", projectDir, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }),
      execFileAsync("git", ["-C", projectDir, "rev-parse", "--git-common-dir"], { timeout: 2000 }),
    ]);
    gitBranch = branchOut.trim() || null;
    const rawCommonDir = commonDirOut.trim();
    // --git-common-dir returns relative path like ".git" for the main worktree
    gitCommonDir = rawCommonDir.startsWith("/")
      ? rawCommonDir
      : path.resolve(projectDir, rawCommonDir);
  } catch { /* not a git repo */ }

  const cached = branchCache.get(projectDir);

  const [fetchHeadMtime, remoteRefMtime] = await Promise.all([
    gitCommonDir ? getFileMtime(path.join(gitCommonDir, "FETCH_HEAD")) : Promise.resolve(null),
    gitCommonDir && gitBranch ? getFileMtime(path.join(gitCommonDir, "refs", "remotes", "origin", gitBranch)) : Promise.resolve(null),
  ]);
  const branchChanged = cached?.lastBranch !== gitBranch;
  const fetchHeadChanged = fetchHeadMtime !== null && fetchHeadMtime !== cached?.lastFetchHeadMtime;
  const remoteRefChanged = remoteRefMtime !== null && remoteRefMtime !== cached?.lastRemoteRefMtime;
  const cacheExpired = cached && !cached.data.prUrl && (Date.now() - cached.cachedAt) > 180_000;

  if (cached && !branchChanged && !fetchHeadChanged && !remoteRefChanged && !cacheExpired) {
    return { ...cached.data, gitBranch, gitCommonDir };
  }

  let prUrl: string | null = null;
  let prTitle: string | null = null;
  if (gitCommonDir && gitBranch && gitBranch !== "HEAD" && gitBranch !== "main" && gitBranch !== "master") {
    const prCacheEntry = await getRepoPrCache(gitCommonDir, fetchHeadMtime);
    const pr = prCacheEntry.prs.get(gitBranch);
    prUrl = pr?.url ?? null;
    prTitle = pr?.title ?? null;
  }

  const data = { gitBranch, gitCommonDir, prUrl, prTitle };
  branchCache.set(projectDir, { data, lastBranch: gitBranch, lastFetchHeadMtime: fetchHeadMtime, lastRemoteRefMtime: remoteRefMtime, cachedAt: Date.now() });
  return data;
}
