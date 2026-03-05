export interface DockerContainer {
  service: string;
  name: string;
  state: string;
  status: string;
}

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
  prUrl: string | null;
  prTitle: string | null;
  editorApp: "vscode" | "cursor" | null;
  isMcpBridge: boolean;
  containers: DockerContainer[];
}

export interface EditorWindow {
  app: "vscode" | "cursor";
  projectDir: string;
  projectName: string;
}

export interface UsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  fiveHourTokens: number;
  weeklyTokens: number;
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
  fiveHourResetsAt: string | null;
  weeklyResetsAt: string | null;
  authError: boolean;
}

export interface DashboardData {
  processes: ClaudeProcess[];
  editorWindows: EditorWindow[];
  collectedAt: string;
  totalWorking: number;
  totalIdle: number;
  usage: UsageData;
}
