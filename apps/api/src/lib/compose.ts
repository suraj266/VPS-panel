import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { docker } from "../docker.js";

export function composeProjectName(slug: string): string {
  return `panel_${slug}`;
}

/**
 * Returns the container name compose creates for a given service.
 * Compose v2 naming: <project>-<service>-<index>
 */
export function composeContainerName(slug: string, service: string, index = 1): string {
  return `${composeProjectName(slug)}-${service}-${index}`;
}

interface RunOptions {
  cwd: string;
  /** Extra args appended to `docker compose -p <project> -f <file>` */
  args: string[];
  /** Stream both stdout + stderr lines to this callback. */
  onLog?: (line: string) => void;
  /** Additional env to pass to the child process. */
  env?: Record<string, string>;
}

async function runCompose(
  projectName: string,
  composeFile: string,
  opts: RunOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const baseArgs = ["compose", "-p", projectName, "-f", composeFile];
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [...baseArgs, ...opts.args], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: false,
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const onChunk = (buf: Buffer, sink: string[]) => {
      const s = buf.toString("utf8");
      sink.push(s);
      if (opts.onLog) {
        for (const line of s.split(/\r?\n/)) {
          if (line.trim()) opts.onLog(line);
        }
      }
    };

    child.stdout.on("data", (b: Buffer) => onChunk(b, stdoutChunks));
    child.stderr.on("data", (b: Buffer) => onChunk(b, stderrChunks));

    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        exitCode: code ?? -1,
      }),
    );
  });
}

export interface ComposeUpInput {
  slug: string;
  workDir: string;
  composeFile: string;
  envFileLines: string[]; // KEY=value pairs (already decrypted)
  onLog: (line: string) => void;
}

export async function composeUp(input: ComposeUpInput): Promise<void> {
  const { slug, workDir, composeFile, envFileLines, onLog } = input;
  const projectName = composeProjectName(slug);

  // Write env file (overwrites any existing .env.panel)
  const envPath = path.join(workDir, ".env.panel");
  await writeFile(envPath, envFileLines.join("\n") + "\n");

  const result = await runCompose(projectName, composeFile, {
    cwd: workDir,
    args: ["--env-file", ".env.panel", "up", "-d", "--build", "--remove-orphans"],
    onLog,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `docker compose up failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
    );
  }
}

export async function composeDown(slug: string, workDir: string, composeFile: string): Promise<void> {
  const projectName = composeProjectName(slug);
  const result = await runCompose(projectName, composeFile, {
    cwd: workDir,
    args: ["down", "--volumes", "--remove-orphans"],
  });
  // Tolerate "no such project" etc. Best-effort cleanup.
  if (result.exitCode !== 0 && !/no such/i.test(result.stderr)) {
    // Not fatal — log but don't throw, since users may delete an app with no live stack.
    console.warn(`[compose] down warning for ${slug}: ${result.stderr}`);
  }
}

/**
 * Stop without removing. Best-effort.
 */
export async function composeStop(slug: string, workDir: string, composeFile: string): Promise<void> {
  const projectName = composeProjectName(slug);
  await runCompose(projectName, composeFile, {
    cwd: workDir,
    args: ["stop"],
  }).catch(() => {});
}

export interface ComposeServiceStatus {
  name: string;
  service: string;
  state: string;
  status: string;
  publishers: Array<{ url: string; targetPort: number; publishedPort: number }>;
}

/**
 * Lists running services in the compose project. Returns [] if project not found.
 */
export async function composePs(slug: string): Promise<ComposeServiceStatus[]> {
  const projectName = composeProjectName(slug);
  // `docker compose ps` doesn't strictly need -f when the project exists,
  // but we pass a dummy compose file path that may not exist.
  // Use `docker ps` filter instead — works without compose file.
  return await dockerPsByComposeProject(projectName);
}

async function dockerPsByComposeProject(projectName: string): Promise<ComposeServiceStatus[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `label=com.docker.compose.project=${projectName}`,
        "--format",
        "{{json .}}",
      ],
      { shell: false },
    );
    const chunks: string[] = [];
    child.stdout.on("data", (b: Buffer) => chunks.push(b.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      const text = chunks.join("");
      const out: ComposeServiceStatus[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            Names: string;
            Labels: string;
            State: string;
            Status: string;
          };
          const labels: Record<string, string> = {};
          for (const pair of obj.Labels.split(",")) {
            const eq = pair.indexOf("=");
            if (eq > 0) labels[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
          out.push({
            name: obj.Names,
            service: labels["com.docker.compose.service"] ?? obj.Names,
            state: obj.State,
            status: obj.Status,
            publishers: [],
          });
        } catch {
          // ignore malformed line
        }
      }
      resolve(out);
    });
  });
}

/**
 * Find all containers belonging to this compose project and attach them to
 * panel_net so the panel_nginx reverse proxy can reach them by service name.
 * Adds an alias = the compose service name on the panel_net endpoint, so
 * nginx `proxy_pass http://<service>:<port>` resolves.
 */
export async function attachProjectContainersToPanelNet(
  slug: string,
  onLog: (line: string) => void,
): Promise<void> {
  const projectName = composeProjectName(slug);
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${projectName}`] },
  });

  const network = docker.getNetwork("panel_net");

  for (const c of containers) {
    const containerName = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
    const service = c.Labels?.["com.docker.compose.service"] ?? containerName;
    const alreadyOnPanelNet = !!c.NetworkSettings?.Networks?.panel_net;
    if (alreadyOnPanelNet) continue;
    try {
      await network.connect({
        Container: c.Id,
        EndpointConfig: { Aliases: [service] },
      });
      onLog(`connected ${containerName} to panel_net (alias: ${service})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog(`WARN: failed to connect ${containerName} to panel_net: ${message}`);
    }
  }
}

/**
 * Verifies that `docker compose` CLI is available. Throws with a useful message if not.
 */
export async function ensureComposeAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", ["compose", "version"], { shell: false });
    child.on("error", () =>
      reject(new Error("`docker compose` CLI not found. Install Docker Desktop or Docker Compose v2.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`docker compose CLI returned exit code ${code}`)),
    );
  });
}
