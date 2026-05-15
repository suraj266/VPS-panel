import Docker from "dockerode";
import { env } from "./env.js";

const isWindows = process.platform === "win32";

export const docker = new Docker(
  isWindows
    ? { socketPath: "//./pipe/docker_engine" }
    : { socketPath: env.DOCKER_SOCKET },
);

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ privatePort: number; publicPort?: number; type: string }>;
  createdAt: number;
  labels: Record<string, string>;
}

export async function listContainers(): Promise<ContainerSummary[]> {
  const containers = await docker.listContainers({ all: true });
  return containers.map((c) => ({
    id: c.Id,
    name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: c.Ports.map((p) => ({
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort,
      type: p.Type,
    })),
    createdAt: c.Created,
    labels: c.Labels ?? {},
  }));
}

export interface PortMapping {
  host: number;
  container: number;
  proto?: "tcp" | "udp";
}

export interface CreateContainerInput {
  image: string;
  name: string;
  ports: PortMapping[];
  env: Record<string, string>;
  restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
}

export async function pullImage(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e) => {
        if (e) reject(e);
        else resolve();
      });
    });
  });
}

export async function createAndStartContainer(
  input: CreateContainerInput,
): Promise<string> {
  await pullImage(input.image);

  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const p of input.ports) {
    const key = `${p.container}/${p.proto ?? "tcp"}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(p.host) }];
  }

  const envArr = Object.entries(input.env).map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    Image: input.image,
    name: input.name,
    Env: envArr,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      RestartPolicy: { Name: input.restartPolicy ?? "unless-stopped" },
    },
  });
  await container.start();
  return container.id;
}

export type ContainerAction = "start" | "stop" | "restart" | "remove";

export async function containerAction(
  id: string,
  action: ContainerAction,
): Promise<void> {
  const container = docker.getContainer(id);
  switch (action) {
    case "start":
      await container.start();
      return;
    case "stop":
      await container.stop();
      return;
    case "restart":
      await container.restart();
      return;
    case "remove":
      await container.remove({ force: true });
      return;
  }
}

export async function containerLogs(
  id: string,
  tail = 200,
): Promise<string> {
  const container = docker.getContainer(id);
  const buf = (await container.logs({
    stdout: true,
    stderr: true,
    tail,
    follow: false,
    timestamps: true,
  })) as unknown as Buffer;
  // Docker multiplexes stdout/stderr with an 8-byte header per frame.
  // For a simple readable view we strip headers.
  return stripDockerLogHeaders(buf);
}

function stripDockerLogHeaders(buf: Buffer): string {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buf.length) break;
    out.push(buf.subarray(start, end));
    offset = end;
  }
  if (out.length === 0) return buf.toString("utf8");
  return Buffer.concat(out).toString("utf8");
}
