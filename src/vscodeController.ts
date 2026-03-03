import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const APP_NAMES: Record<"vscode" | "cursor", string> = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
};

export async function focusVSCodeWindow(projectDir: string, app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  const appName = APP_NAMES[app];
  try {
    // Activate immediately via osascript, then open the folder
    await Promise.all([
      execFileAsync("osascript", ["-e", `tell application "${appName}" to activate`]),
      execFileAsync("open", ["-a", appName, projectDir]),
    ]);
    return true;
  } catch {
    return false;
  }
}
