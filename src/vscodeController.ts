import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const APP_NAMES: Record<"vscode" | "cursor", string> = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
};

export async function focusVSCodeWindow(projectDir: string, app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  try {
    await execFileAsync("open", ["-a", APP_NAMES[app], projectDir]);
    return true;
  } catch {
    return false;
  }
}
