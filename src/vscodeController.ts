import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Candidates in priority order
const CODE_CLI_CANDIDATES = [
  "/usr/local/bin/code",
  "/usr/bin/code",
  "/opt/homebrew/bin/code",
];

async function findCodeCli(): Promise<string | null> {
  for (const p of CODE_CLI_CANDIDATES) {
    try {
      await execFileAsync("test", ["-x", p]);
      return p;
    } catch {
      // not found
    }
  }
  // fallback: try `which code`
  try {
    const { stdout } = await execFileAsync("which", ["code"]);
    const p = stdout.trim();
    if (p) return p;
  } catch {
    // ignore
  }
  return null;
}

export async function focusVSCodeWindow(projectDir: string): Promise<boolean> {
  const codeCli = await findCodeCli();
  if (codeCli) {
    try {
      // --reuse-window focuses the existing window that has this folder open
      await execFileAsync(codeCli, ["--reuse-window", projectDir]);
      return true;
    } catch {
      // fall through to AppleScript
    }
  }

  // AppleScript fallback: VSCode's process name in System Events is "Electron"
  const script = `
    tell application "System Events"
      repeat with procName in {"Electron", "Cursor", "Code"}
        if exists process procName then
          tell process procName
            repeat with w in (every window)
              if title of w contains " — " then
                perform action "AXRaise" of w
                exit repeat
              end if
            end repeat
          end tell
          tell application procName to activate
          return "ok"
        end if
      end repeat
    end tell
  `;
  try {
    await execFileAsync("osascript", ["-e", script]);
    return true;
  } catch {
    return false;
  }
}
