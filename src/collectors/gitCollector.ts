import path from "path";
import { stat } from "fs/promises";
import { execFileAsync } from "../utils/execUtils.js";

type GitInfo = { gitBranch: string | null; gitCommonDir: string | null; prUrl: string | null; prTitle: string | null };

type GitCache = {
  data: GitInfo;
  lastBranch: string | null;
  lastFetchHeadMtime: number | null;
};

const gitCache = new Map<string, GitCache>();

async function getFetchHeadMtime(gitCommonDir: string): Promise<number | null> {
  try {
    const s = await stat(path.join(gitCommonDir, "FETCH_HEAD"));
    return s.mtimeMs;
  } catch { return null; }
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

  const cached = gitCache.get(projectDir);

  // Fetch PR only when: no cache, branch changed, or FETCH_HEAD updated (push/pull/fetch happened)
  const fetchHeadMtime = gitCommonDir ? await getFetchHeadMtime(gitCommonDir) : null;
  const branchChanged = cached?.lastBranch !== gitBranch;
  const fetchHeadChanged = fetchHeadMtime !== null && fetchHeadMtime !== cached?.lastFetchHeadMtime;

  if (cached && !branchChanged && !fetchHeadChanged) {
    return { ...cached.data, gitBranch, gitCommonDir };
  }

  let prUrl: string | null = null;
  let prTitle: string | null = null;
  if (gitBranch && gitBranch !== "HEAD" && gitBranch !== "main" && gitBranch !== "master") {
    try {
      const { stdout: prOut } = await execFileAsync(
        "gh", ["pr", "view", "--json", "url,title", "-q", "[.url,.title] | join(\"\\t\")"],
        { cwd: projectDir, timeout: 5000 }
      );
      const parts = prOut.trim().split("\t");
      prUrl = parts[0] || null;
      prTitle = parts[1] || null;
    } catch { /* no PR or gh not available */ }
  }

  const data = { gitBranch, gitCommonDir, prUrl, prTitle };
  gitCache.set(projectDir, { data, lastBranch: gitBranch, lastFetchHeadMtime: fetchHeadMtime });
  return data;
}
