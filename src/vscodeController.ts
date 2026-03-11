import * as path from "path";
import * as fs from "fs";
import { execFileAsync } from "./utils/execUtils.js";
import { EDITOR_CONFIGS } from "./editorConfig.js";

const SWIFT_BINARY = path.resolve(__dirname, "../tools/focus-window/.build/release/focus-window");

function hasSwiftBinary(): boolean {
  try {
    fs.accessSync(SWIFT_BINARY, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function openWorktreeInVSCode(worktreePath: string, newWindow?: boolean): Promise<boolean> {
  try {
    const flag = newWindow ? "--new-window" : "--reuse-window";
    await execFileAsync("code", [flag, worktreePath]);
    return true;
  } catch {
    return false;
  }
}

export async function focusVSCodeWindow(projectDir: string, app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  const config = EDITOR_CONFIGS.find(c => c.app === app);
  if (!config) return false;
  try {
    if (hasSwiftBinary()) {
      await execFileAsync(SWIFT_BINARY, [config.bundleId, projectDir]);
    } else {
      // Fallback: osascript + open -a
      await Promise.all([
        execFileAsync("osascript", ["-e", `tell application "${config.appName}" to activate`]),
        execFileAsync("open", ["-a", config.appName, projectDir]),
      ]);
    }
    return true;
  } catch {
    return false;
  }
}
