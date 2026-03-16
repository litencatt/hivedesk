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

async function collectContainersFromFile(composeFile: string): Promise<DockerContainer[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker", ["compose", "-f", composeFile, "ps", "--all", "--format", "json"],
      { timeout: 3000 }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];

    // Docker Compose v2.21+ outputs a JSON array; older versions output NDJSON
    const containers: DockerContainer[] = [];
    const parseItem = (obj: Record<string, unknown>) => {
      containers.push({
        service: String(obj.Service ?? ""),
        name: String(obj.Name ?? ""),
        state: String(obj.State ?? "").toLowerCase(),
        status: String(obj.Status ?? ""),
      });
    };

    if (trimmed.startsWith("[")) {
      // JSON array format
      const arr = JSON.parse(trimmed) as Array<Record<string, unknown>>;
      for (const obj of arr) parseItem(obj);
    } else {
      // NDJSON format
      for (const line of trimmed.split("\n").filter(Boolean)) {
        try { parseItem(JSON.parse(line) as Record<string, unknown>); } catch { /* skip malformed */ }
      }
    }
    return containers;
  } catch {
    return [];
  }
}

export async function collectDockerContainers(projectDir: string): Promise<DockerContainer[]> {
  if (!projectDir) return [];
  const composeFile = await findComposeFile(projectDir, 2);
  if (!composeFile) return [];
  return collectContainersFromFile(composeFile);
}
