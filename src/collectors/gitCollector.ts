import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export async function getGitInfo(projectDir: string): Promise<{
  gitBranch: string | null;
  gitCommonDir: string | null;
  prUrl: string | null;
}> {
  let gitBranch: string | null = null;
  let gitCommonDir: string | null = null;
  let prUrl: string | null = null;
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
          "gh", ["pr", "view", "--json", "url", "-q", ".url"],
          { cwd: projectDir, timeout: 3000 }
        );
        prUrl = prOut.trim() || null;
      } catch { /* no PR or gh not available */ }
    }
  } catch { /* not a git repo or git not available */ }

  return { gitBranch, gitCommonDir, prUrl };
}
