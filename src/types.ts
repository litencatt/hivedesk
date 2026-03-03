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
  isMcpBridge: boolean;
}

export interface DashboardData {
  processes: ClaudeProcess[];
  collectedAt: string;
  totalWorking: number;
  totalIdle: number;
}
