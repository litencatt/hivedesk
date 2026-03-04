import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

const APP_NAMES: Record<"vscode" | "cursor", string> = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
};

const BUNDLE_IDS: Record<"vscode" | "cursor", string> = {
  vscode: "com.microsoft.VSCode",
  cursor: "com.todesktop.230313mzl4w4u92",
};

const SWIFT_BINARY = path.resolve(__dirname, "../tools/focus-window/.build/release/focus-window");

function hasSwiftBinary(): boolean {
  try {
    fs.accessSync(SWIFT_BINARY, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function focusVSCodeWindow(projectDir: string, app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  const appName = APP_NAMES[app];
  try {
    if (hasSwiftBinary()) {
      await execFileAsync(SWIFT_BINARY, [BUNDLE_IDS[app], projectDir]);
    } else {
      // Fallback: osascript + open -a
      await Promise.all([
        execFileAsync("osascript", ["-e", `tell application "${appName}" to activate`]),
        execFileAsync("open", ["-a", appName, projectDir]),
      ]);
    }
    return true;
  } catch {
    return false;
  }
}
