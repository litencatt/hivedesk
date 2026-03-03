export interface ClaudeProcess {
  pid: number;
  projectName: string;
  projectDir: string;
  cpuPercent: number;
  memPercent: number;
  status: "working" | "idle";
  stat: string;
  elapsedTime: string;
  elapsedSeconds: number;
  currentTask: string | null;
  openFiles: string[];
  gitBranch: string | null;
  gitCommonDir: string | null;
  modelName: string | null;
  editorApp: "vscode" | "cursor" | null;
  isMcpBridge: boolean;
}

export interface EditorWindow {
  app: "vscode" | "cursor";
  projectDir: string;
  projectName: string;
}

export interface DashboardData {
  processes: ClaudeProcess[];
  editorWindows: EditorWindow[];
  collectedAt: string;
  totalWorking: number;
  totalIdle: number;
}
