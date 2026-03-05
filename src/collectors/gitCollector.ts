import path from "path";
import { execFileAsync } from "../utils/execUtils.js";

type GitInfo = { gitBranch: string | null; gitCommonDir: string | null; prUrl: string | null; prTitle: string | null };

const gitCache = new Map<string, { data: GitInfo; fetchedAt: number }>();
const GIT_CACHE_TTL_MS = 60 * 1000; // branch/PR refresh every 60s

export async function collectGitInfo(projectDir: string): Promise<GitInfo> {
  const now = Date.now();
  const cached = gitCache.get(projectDir);
  if (cached && now - cached.fetchedAt < GIT_CACHE_TTL_MS) {
    return cached.data;
  }

  let gitBranch: string | null = null;
  let gitCommonDir: string | null = null;
  let prUrl: string | null = null;
  let prTitle: string | null = null;
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

    if (gitBranch && gitBranch !== "HEAD" && gitBranch !== "main" && gitBranch !== "master") {
      try {
        const { stdout: prOut } = await execFileAsync(
          "gh", ["pr", "view", "--json", "url,title", "-q", "[.url,.title] | join(\"\\t\")"],
          { cwd: projectDir, timeout: 3000 }
        );
        const parts = prOut.trim().split("\t");
        prUrl = parts[0] || null;
        prTitle = parts[1] || null;
      } catch { /* no PR or gh not available */ }
    }
  } catch { /* not a git repo or git not available */ }

  const data = { gitBranch, gitCommonDir, prUrl, prTitle };
  gitCache.set(projectDir, { data, fetchedAt: now });
  return data;
}
