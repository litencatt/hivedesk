import { execFileAsync } from "./utils/execUtils.js";
import { EDITOR_CONFIGS } from "./editorConfig.js";

export async function openWorktreeInVSCode(worktreePath: string, newWindow?: boolean): Promise<boolean> {
  try {
    const flag = newWindow ? "--new-window" : "--reuse-window";
    await execFileAsync("code", [flag, worktreePath]);
    return true;
  } catch {
    return false;
  }
}

// Activate (bring to front) without opening/changing window content
export async function focusVSCodeWindow(app: "vscode" | "cursor" = "vscode"): Promise<boolean> {
  const config = EDITOR_CONFIGS.find(c => c.app === app);
  if (!config) return false;
  try {
    await execFileAsync("osascript", ["-e", `tell application "${config.appName}" to activate`]);
    return true;
  } catch {
    return false;
  }
}
