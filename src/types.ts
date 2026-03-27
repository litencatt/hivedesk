export interface DockerContainer {
  service: string;
  name: string;
  state: string;
  status: string;
}

export interface ClaudeSession {
  pid: number;
  cpuPercent: number;
  memPercent: number;
  status: "working" | "idle";
  claudeStatus: "thinking" | "tool_use" | "executing" | "waiting" | null;
  stat: string;
  elapsedTime: string;
  elapsedSeconds: number;
  currentTask: string | null;
  openFiles: string[];
  modelName: string | null;
  isMcpBridge: boolean;
}

export interface Worktree {
  projectDir: string;
  projectName: string;
  gitBranch: string | null;
  gitCommonDir: string | null;
  prUrl: string | null;
  prTitle: string | null;
  containers: DockerContainer[];
  terminal: "vscode" | "cursor" | "ghostty" | null;
  tmuxSocket: string | null;
  tmuxSession: string | null;
  sessions: ClaudeSession[];
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
  oauthDisabled: boolean;
}

export interface DashboardData {
  worktrees: Worktree[];
  collectedAt: string;
  totalWorking: number;
  totalIdle: number;
  usage: UsageData;
}
