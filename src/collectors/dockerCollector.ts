import { access, readdir } from "fs/promises";
import { execFileAsync } from "../utils/execUtils.js";
import path from "path";
import { DockerContainer } from "../types.js";

const COMPOSE_FILE_NAMES = [
  "docker-compose.yml", "docker-compose.yaml",
  "compose.yml", "compose.yaml",
];

export async function findComposeFile(dir: string, depth: number): Promise<string | null> {
  for (const name of COMPOSE_FILE_NAMES) {
    const candidate = path.join(dir, name);
    try {
      await access(candidate);
      return candidate;
    } catch { /* not found */ }
  }
  if (depth <= 0) return null;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const found = await findComposeFile(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
  } catch { /* skip unreadable dirs */ }
  return null;
}

async function getWorktreeDirs(projectDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["-C", projectDir, "worktree", "list", "--porcelain"],
      { timeout: 2000 }
    );
    const dirs: string[] = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        dirs.push(line.slice("worktree ".length).trim());
      }
    }
    return dirs.length > 0 ? dirs : [projectDir];
  } catch {
    return [projectDir];
  }
}

async function collectContainersFromFile(composeFile: string): Promise<DockerContainer[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker", ["compose", "-f", composeFile, "ps", "--format", "json"],
      { timeout: 3000 }
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    const containers: DockerContainer[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        containers.push({
          service: obj.Service ?? "",
          name: obj.Name ?? "",
          state: (obj.State ?? "").toLowerCase(),
          status: obj.Status ?? "",
        });
      } catch { /* skip malformed */ }
    }
    return containers;
  } catch {
    return [];
  }
}

export async function collectDockerContainers(projectDir: string): Promise<DockerContainer[]> {
  if (!projectDir) return [];

  // Search all git worktrees so containers started from a different worktree are found
  const worktreeDirs = await getWorktreeDirs(projectDir);

  const results = await Promise.all(
    worktreeDirs.map(async (dir) => {
      const composeFile = await findComposeFile(dir, 2);
      if (!composeFile) return [];
      return collectContainersFromFile(composeFile);
    })
  );

  // Deduplicate by container name
  const seen = new Set<string>();
  const containers: DockerContainer[] = [];
  for (const batch of results) {
    for (const c of batch) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        containers.push(c);
      }
    }
  }
  return containers;
}
