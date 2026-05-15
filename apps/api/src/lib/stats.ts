import { docker } from "../docker.js";

export interface HostStats {
  docker: {
    version: string;
    apiVersion: string;
    containers: number;
    containersRunning: number;
    containersPaused: number;
    containersStopped: number;
    images: number;
  };
  host: {
    cpus: number;
    memoryBytes: number;
    kernelVersion: string;
    os: string;
    arch: string;
  };
  disk: {
    layersSize: number;
    imagesCount: number;
    imagesSize: number;
    containersCount: number;
    containersSize: number;
    volumesCount: number;
    volumesSize: number;
    buildCacheSize: number;
    total: number;
  };
}

export interface ContainerStatsRow {
  id: string;
  name: string;
  image: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

export async function getHostStats(): Promise<HostStats> {
  const info = await docker.info();
  const df = await new Promise<DfResponse>((resolve, reject) => {
    docker.modem.dial(
      { path: "/system/df", method: "GET", statusCodes: { 200: true } },
      (err: unknown, body: unknown) => {
        if (err) reject(err as Error);
        else resolve(body as DfResponse);
      },
    );
  });

  const imagesSize = (df.Images ?? []).reduce(
    (sum, i) => sum + (i.Size ?? 0),
    0,
  );
  const containersSize = (df.Containers ?? []).reduce(
    (sum, c) => sum + (c.SizeRw ?? 0),
    0,
  );
  const volumesSize = (df.Volumes ?? []).reduce(
    (sum, v) => sum + (v.UsageData?.Size ?? 0),
    0,
  );
  const buildCacheSize = (df.BuildCache ?? []).reduce(
    (sum, b) => sum + (b.Size ?? 0),
    0,
  );
  const layersSize = df.LayersSize ?? 0;

  return {
    docker: {
      version: info.ServerVersion ?? "?",
      apiVersion: (info as { ApiVersion?: string }).ApiVersion ?? "?",
      containers: info.Containers ?? 0,
      containersRunning: info.ContainersRunning ?? 0,
      containersPaused: info.ContainersPaused ?? 0,
      containersStopped: info.ContainersStopped ?? 0,
      images: info.Images ?? 0,
    },
    host: {
      cpus: info.NCPU ?? 0,
      memoryBytes: info.MemTotal ?? 0,
      kernelVersion: info.KernelVersion ?? "?",
      os: info.OperatingSystem ?? "?",
      arch: info.Architecture ?? "?",
    },
    disk: {
      layersSize,
      imagesCount: (df.Images ?? []).length,
      imagesSize,
      containersCount: (df.Containers ?? []).length,
      containersSize,
      volumesCount: (df.Volumes ?? []).length,
      volumesSize,
      buildCacheSize,
      total: imagesSize + containersSize + volumesSize + buildCacheSize,
    },
  };
}

interface DfResponse {
  LayersSize?: number;
  Images?: Array<{ Size?: number }>;
  Containers?: Array<{ SizeRw?: number }>;
  Volumes?: Array<{ UsageData?: { Size?: number } }>;
  BuildCache?: Array<{ Size?: number }>;
}

interface DockerStatsSample {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number; inactive_file?: number };
  };
}

function computeCpuPercent(s: DockerStatsSample): number {
  const cur = s.cpu_stats.cpu_usage.total_usage;
  const prev = s.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const curSys = s.cpu_stats.system_cpu_usage ?? 0;
  const prevSys = s.precpu_stats?.system_cpu_usage ?? 0;
  const cpus = s.cpu_stats.online_cpus ?? 1;

  const cpuDelta = cur - prev;
  const sysDelta = curSys - prevSys;
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  return (cpuDelta / sysDelta) * cpus * 100;
}

function computeMemBytes(s: DockerStatsSample): number {
  const usage = s.memory_stats.usage ?? 0;
  // Subtract cache to get actual working memory (closer to `docker stats` output)
  const cache =
    s.memory_stats.stats?.inactive_file ??
    s.memory_stats.stats?.cache ??
    0;
  return Math.max(0, usage - cache);
}

export async function getRunningContainerStats(
  limit = 20,
): Promise<ContainerStatsRow[]> {
  const list = await docker.listContainers({ all: false });
  // Sample each one in parallel.
  const samples = await Promise.all(
    list.slice(0, limit).map(async (c) => {
      try {
        const stats = (await docker
          .getContainer(c.Id)
          .stats({ stream: false })) as unknown as DockerStatsSample;
        const memBytes = computeMemBytes(stats);
        const memLimit = stats.memory_stats.limit ?? 0;
        return {
          id: c.Id,
          name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
          image: c.Image,
          cpuPercent: Math.round(computeCpuPercent(stats) * 10) / 10,
          memoryBytes: memBytes,
          memoryLimitBytes: memLimit,
          memoryPercent:
            memLimit > 0 ? Math.round((memBytes / memLimit) * 1000) / 10 : 0,
        } satisfies ContainerStatsRow;
      } catch {
        return null;
      }
    }),
  );
  return samples
    .filter((s): s is ContainerStatsRow => s !== null)
    .sort((a, b) => b.memoryBytes - a.memoryBytes);
}
