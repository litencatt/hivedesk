import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const CLI_CANDIDATES: Record<"vscode" | "cursor", string[]> = {
  vscode: ["/usr/local/bin/code", "/usr/bin/code", "/opt/homebrew/bin/code"],
  cursor: ["/usr/local/bin/cursor", "/usr/bin/cursor", "/opt/homebrew/bin/cursor"],
};

const cachedCli: Record<string, string | null | undefined> = {};

async function findCli(app: "vscode" | "cursor"): Promise<string | null> {
  if (cachedCli[app] !== undefined) return cachedCli[app] ?? null;
  for (const p of CLI_CANDIDATES[app]) {
    try {
      await execFileAsync("test", ["-x", p]);
      cachedCli[app] = p;
      return p;
    } catch { /* not found */ }
  }
  try {
    const { stdout } = await execFileAsync("which", [app === "vscode" ? "code" : "cursor"]);
    const p = stdout.trim();
    if (p) { cachedCli[app] = p; return p; }
  } catch { /* ignore */ }
  cachedCli[app] = null;
  return null;
}

export async function focusVSCodeWindow(projectDir: string, app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  const cli = await findCli(app);
  if (cli) {
    try {
      await execFileAsync(cli, ["--reuse-window", projectDir]);
      return true;
    } catch { /* fall through */ }
  }
  return false;
}
