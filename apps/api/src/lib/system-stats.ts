import { docker } from "../docker.js";

const HOST_CONTAINER = "panel_host";

// Sentinel that separates the concatenated /proc reads in a single exec call.
const SEP = "---PANELSEP---";

// CPU % and network throughput need a "rate over time" — we cache the previous
// sample in module-level state and compute the delta against it on each call.
// On the very first call (no cache yet) we take two samples 500ms apart so the
// caller still gets a non-zero reading.
interface CpuLine {
  total: number;
  idle: number;
}
interface CpuSnapshot {
  overall: CpuLine;
  perCore: CpuLine[];
}
interface NetSnapshot {
  time: number;
  ifaces: Record<string, { rx: number; tx: number }>;
}
let lastCpu: CpuSnapshot | null = null;
let lastNet: NetSnapshot | null = null;

interface ProcSample {
  stat: string;
  meminfo: string;
  loadavg: string;
  uptime: string;
  netDev: string;
  df: string;
}

async function execHost(cmd: string[]): Promise<string> {
  const container = docker.getContainer(HOST_CONTAINER);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      { write: (c: Buffer) => out.push(c) } as unknown as NodeJS.WritableStream,
      { write: (c: Buffer) => err.push(c) } as unknown as NodeJS.WritableStream,
    );
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const stderr = Buffer.concat(err).toString("utf8").trim();
  const stdout = Buffer.concat(out).toString("utf8");
  if (!stdout && stderr) {
    throw new Error(`exec in ${HOST_CONTAINER} failed: ${stderr}`);
  }
  return stdout;
}

// Single shell exec batches all the reads we need. Cheaper than 6 separate
// exec calls (each one of those round-trips through the docker socket).
async function sampleProc(): Promise<ProcSample> {
  const script =
    `cat /proc/stat; printf '\\n${SEP}\\n'; ` +
    `cat /proc/meminfo; printf '\\n${SEP}\\n'; ` +
    `cat /proc/loadavg; printf '\\n${SEP}\\n'; ` +
    `cat /proc/uptime; printf '\\n${SEP}\\n'; ` +
    `cat /proc/net/dev; printf '\\n${SEP}\\n'; ` +
    `df -B1 -T -P 2>/dev/null`;
  const stdout = await execHost(["sh", "-c", script]);
  const parts = stdout.split(SEP).map((p) => p.trim());
  return {
    stat: parts[0] ?? "",
    meminfo: parts[1] ?? "",
    loadavg: parts[2] ?? "",
    uptime: parts[3] ?? "",
    netDev: parts[4] ?? "",
    df: parts[5] ?? "",
  };
}

function parseCpuLine(line: string): CpuLine {
  // Format: "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
  const nums = line.split(/\s+/).slice(1).map((n) => Number(n) || 0);
  const total = nums.reduce((a, b) => a + b, 0);
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0); // idle + iowait
  return { total, idle };
}

function parseCpuStat(text: string): CpuSnapshot {
  const lines = text.split("\n");
  const overall = lines.find((l) => l.startsWith("cpu ")) ?? "cpu 0 0 0 0";
  const perCore = lines
    .filter((l) => /^cpu\d+\s/.test(l))
    .map(parseCpuLine);
  return { overall: parseCpuLine(overall), perCore };
}

function cpuDeltaPercent(prev: CpuLine, cur: CpuLine): number {
  const totalDelta = cur.total - prev.total;
  const idleDelta = cur.idle - prev.idle;
  if (totalDelta <= 0) return 0;
  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

interface MemInfo {
  totalBytes: number;
  freeBytes: number;
  availableBytes: number;
  bufferedBytes: number;
  cachedBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

function parseMeminfo(text: string): MemInfo {
  const map: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\S+):\s+(\d+)/);
    if (m && m[1] && m[2]) {
      // /proc/meminfo values are in kB; promote to bytes.
      map[m[1]] = Number(m[2]) * 1024;
    }
  }
  return {
    totalBytes: map.MemTotal ?? 0,
    freeBytes: map.MemFree ?? 0,
    // MemAvailable is the modern "what can be reclaimed for new allocations"
    // — closer to what `free`/`htop` show as available than MemFree.
    availableBytes: map.MemAvailable ?? map.MemFree ?? 0,
    bufferedBytes: map.Buffers ?? 0,
    cachedBytes: map.Cached ?? 0,
    swapTotalBytes: map.SwapTotal ?? 0,
    swapFreeBytes: map.SwapFree ?? 0,
  };
}

function parseLoadavg(text: string): { "1m": number; "5m": number; "15m": number } {
  const parts = text.trim().split(/\s+/);
  return {
    "1m": Number(parts[0]) || 0,
    "5m": Number(parts[1]) || 0,
    "15m": Number(parts[2]) || 0,
  };
}

function parseUptime(text: string): number {
  return Number(text.trim().split(/\s+/)[0]) || 0;
}

function parseNetDev(text: string): NetSnapshot {
  // Skip the 2 header lines; rest look like:
  //   eth0: <rx_bytes> <rx_packets> <errs> <drop> <fifo> <frame> <compressed> <multicast> <tx_bytes> ...
  const ifaces: Record<string, { rx: number; tx: number }> = {};
  for (const line of text.split("\n").slice(2)) {
    const m = line.match(/^\s*(\S+):\s+(.+)/);
    if (!m || !m[1] || !m[2]) continue;
    const name = m[1];
    // Skip noise interfaces — loopback / docker bridges / vethN pairs aren't
    // useful for "VPS uplink throughput".
    if (
      name === "lo" ||
      name.startsWith("docker") ||
      name.startsWith("br-") ||
      name.startsWith("veth")
    ) {
      continue;
    }
    const nums = m[2].split(/\s+/).map((n) => Number(n) || 0);
    ifaces[name] = { rx: nums[0] ?? 0, tx: nums[8] ?? 0 };
  }
  return { time: Date.now(), ifaces };
}

export interface DiskMount {
  filesystem: string;
  type: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usedPercent: number;
  mountpoint: string;
}

function parseDf(text: string): DiskMount[] {
  // panel_host's bind mount of `/:/host` is recursive, so every host
  // partition shows up here prefixed with /host. We filter to those and
  // strip the prefix so the user sees the host's real mountpoint.
  const SKIP_FS_TYPES = new Set([
    "tmpfs",
    "devtmpfs",
    "overlay",
    "squashfs",
    "proc",
    "sysfs",
    "cgroup",
    "cgroup2",
    "mqueue",
    "pstore",
    "devpts",
    "tracefs",
    "debugfs",
    "fusectl",
    "bpf",
    "binfmt_misc",
    "autofs",
    "rpc_pipefs",
    "nsfs",
  ]);
  const rows: DiskMount[] = [];
  const lines = text.split("\n").slice(1);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const filesystem = parts[0]!;
    const type = parts[1]!;
    const totalBytes = Number(parts[2]) || 0;
    const usedBytes = Number(parts[3]) || 0;
    const availBytes = Number(parts[4]) || 0;
    const usedPercent = parseFloat((parts[5] ?? "0").replace("%", "")) || 0;
    let mountpoint = parts.slice(6).join(" ");

    if (SKIP_FS_TYPES.has(type)) continue;
    if (totalBytes === 0) continue;

    // Only host-side mounts (everything under /host because of the recursive
    // bind mount). Translate /host -> / and /host/foo -> /foo.
    if (mountpoint === "/host") mountpoint = "/";
    else if (mountpoint.startsWith("/host/")) mountpoint = mountpoint.slice(5);
    else continue;

    rows.push({
      filesystem,
      type,
      totalBytes,
      usedBytes,
      availBytes,
      usedPercent,
      mountpoint,
    });
  }
  // De-dupe by mountpoint (rbind can occasionally surface the same mount
  // twice). Keep the first occurrence.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.mountpoint)) return false;
    seen.add(r.mountpoint);
    return true;
  });
}

export interface SystemLiveStats {
  cpu: {
    usagePercent: number;
    cores: number;
    perCorePercent: number[];
    loadAvg: { "1m": number; "5m": number; "15m": number };
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    availableBytes: number;
    cachedBytes: number;
    bufferedBytes: number;
    usedPercent: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
    swapUsedPercent: number;
  };
  disk: {
    mounts: DiskMount[];
  };
  network: {
    interfaces: Array<{
      name: string;
      rxBytesPerSec: number;
      txBytesPerSec: number;
      rxBytesTotal: number;
      txBytesTotal: number;
    }>;
  };
  uptimeSeconds: number;
  timestamp: number;
}

export async function getSystemLiveStats(): Promise<SystemLiveStats> {
  let sample = await sampleProc();
  let curCpu = parseCpuStat(sample.stat);
  let curNet = parseNetDev(sample.netDev);

  let prevCpu = lastCpu;
  let prevNet = lastNet;

  // First call ever (or after a server restart): take a second sample after a
  // short pause so we can compute a meaningful CPU/network delta. Subsequent
  // calls just use the cached previous sample, which gives a longer (and more
  // accurate) measurement window if the client polls every couple seconds.
  if (!prevCpu) {
    await new Promise((r) => setTimeout(r, 500));
    sample = await sampleProc();
    prevCpu = curCpu;
    prevNet = curNet;
    curCpu = parseCpuStat(sample.stat);
    curNet = parseNetDev(sample.netDev);
  }

  const overallPct = cpuDeltaPercent(prevCpu.overall, curCpu.overall);
  const perCorePct = curCpu.perCore.map((c, i) => {
    const prev = prevCpu!.perCore[i];
    return prev ? cpuDeltaPercent(prev, c) : 0;
  });

  const netDtSec = Math.max(
    0.001,
    (curNet.time - (prevNet?.time ?? curNet.time - 1000)) / 1000,
  );
  const networkIfaces = Object.entries(curNet.ifaces).map(([name, cur]) => {
    const prev = prevNet?.ifaces[name] ?? { rx: cur.rx, tx: cur.tx };
    return {
      name,
      rxBytesTotal: cur.rx,
      txBytesTotal: cur.tx,
      rxBytesPerSec: Math.max(0, (cur.rx - prev.rx) / netDtSec),
      txBytesPerSec: Math.max(0, (cur.tx - prev.tx) / netDtSec),
    };
  });

  // Cache for the next request's delta.
  lastCpu = curCpu;
  lastNet = curNet;

  const mem = parseMeminfo(sample.meminfo);
  const memUsed = Math.max(0, mem.totalBytes - mem.availableBytes);
  const swapUsed = Math.max(0, mem.swapTotalBytes - mem.swapFreeBytes);

  return {
    cpu: {
      usagePercent: Math.round(overallPct * 10) / 10,
      cores: curCpu.perCore.length || 1,
      perCorePercent: perCorePct.map((p) => Math.round(p * 10) / 10),
      loadAvg: parseLoadavg(sample.loadavg),
    },
    memory: {
      totalBytes: mem.totalBytes,
      usedBytes: memUsed,
      freeBytes: mem.freeBytes,
      availableBytes: mem.availableBytes,
      cachedBytes: mem.cachedBytes,
      bufferedBytes: mem.bufferedBytes,
      usedPercent:
        mem.totalBytes > 0
          ? Math.round((memUsed / mem.totalBytes) * 1000) / 10
          : 0,
      swapTotalBytes: mem.swapTotalBytes,
      swapUsedBytes: swapUsed,
      swapUsedPercent:
        mem.swapTotalBytes > 0
          ? Math.round((swapUsed / mem.swapTotalBytes) * 1000) / 10
          : 0,
    },
    disk: { mounts: parseDf(sample.df) },
    network: { interfaces: networkIfaces },
    uptimeSeconds: parseUptime(sample.uptime),
    timestamp: Date.now(),
  };
}
