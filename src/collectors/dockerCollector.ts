import { execFile } from "child_process";
import { promisify } from "util";
import { access, readdir } from "fs/promises";
import path from "path";
import { DockerContainer } from "../types.js";

const execFileAsync = promisify(execFile);

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

export async function collectDockerContainers(projectDir: string): Promise<DockerContainer[]> {
  if (!projectDir) return [];

  const composeFile = await findComposeFile(projectDir, 2);
  if (!composeFile) return [];

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
