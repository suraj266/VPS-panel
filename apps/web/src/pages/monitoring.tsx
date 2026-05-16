import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Network,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";
import { Sparkline } from "../components/sparkline";

interface SystemLiveStats {
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
    mounts: Array<{
      filesystem: string;
      type: string;
      totalBytes: number;
      usedBytes: number;
      availBytes: number;
      usedPercent: number;
      mountpoint: string;
    }>;
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

// How many samples we keep client-side for the sparklines. At 2-second
// polling, 60 samples ≈ last 2 minutes.
const HISTORY_LIMIT = 60;
const POLL_MS = 2000;

function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`;
}

function formatBitsPerSec(bytesPerSec: number): string {
  const bps = bytesPerSec * 8;
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} kbps`;
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

// Pick a colour band for a percentage — green under 60, amber 60-85, red over.
function pctColor(pct: number): { text: string; bar: string } {
  if (pct >= 85) return { text: "text-red-300", bar: "bg-red-500" };
  if (pct >= 60) return { text: "text-amber-300", bar: "bg-amber-500" };
  return { text: "text-emerald-300", bar: "bg-emerald-500" };
}

interface HistoryState {
  cpu: number[];
  memory: number[];
  rxBytesPerSec: number[];
  txBytesPerSec: number[];
  // Sum across all non-loopback interfaces for the overall network sparkline.
}

const EMPTY_HISTORY: HistoryState = {
  cpu: [],
  memory: [],
  rxBytesPerSec: [],
  txBytesPerSec: [],
};

export function MonitoringPage() {
  const stats = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api<SystemLiveStats>("/stats/system"),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const lastTimestamp = useRef<number>(0);

  // Append each fresh sample to the rolling history. Guard against duplicate
  // appends if React Query re-renders without a new fetch (e.g. window focus).
  useEffect(() => {
    const d = stats.data;
    if (!d) return;
    if (d.timestamp === lastTimestamp.current) return;
    lastTimestamp.current = d.timestamp;
    const totalRx = d.network.interfaces.reduce(
      (s, i) => s + i.rxBytesPerSec,
      0,
    );
    const totalTx = d.network.interfaces.reduce(
      (s, i) => s + i.txBytesPerSec,
      0,
    );
    setHistory((prev) => ({
      cpu: appendTrim(prev.cpu, d.cpu.usagePercent),
      memory: appendTrim(prev.memory, d.memory.usedPercent),
      rxBytesPerSec: appendTrim(prev.rxBytesPerSec, totalRx),
      txBytesPerSec: appendTrim(prev.txBytesPerSec, totalTx),
    }));
  }, [stats.data]);

  return (
    <Layout
      title="Monitoring"
      subtitle="Live CPU, memory, disk and network stats from the VPS host."
      actions={
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Activity
            className={
              "w-3.5 h-3.5 " +
              (stats.isFetching ? "text-emerald-400" : "text-slate-500")
            }
          />
          {stats.isFetching ? "Updating…" : `Polling every ${POLL_MS / 1000}s`}
        </div>
      }
    >
      {stats.isError && (
        <div className="bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 text-sm text-red-300 mb-4">
          {(stats.error as Error).message}. The privileged{" "}
          <code className="bg-slate-900 px-1 rounded">panel_host</code> sidecar
          must be running for live stats.
        </div>
      )}

      {!stats.data && !stats.isError && (
        <div className="text-slate-400 text-sm">Loading host stats…</div>
      )}

      {stats.data && (
        <div className="space-y-6">
          <OverviewCards data={stats.data} history={history} />
          <CpuSection data={stats.data} history={history.cpu} />
          <MemorySection data={stats.data} history={history.memory} />
          <DiskSection mounts={stats.data.disk.mounts} />
          <NetworkSection
            interfaces={stats.data.network.interfaces}
            rxHistory={history.rxBytesPerSec}
            txHistory={history.txBytesPerSec}
          />
        </div>
      )}
    </Layout>
  );
}

function appendTrim(arr: number[], v: number): number[] {
  const next = arr.length >= HISTORY_LIMIT ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
}

function OverviewCards({
  data,
  history,
}: {
  data: SystemLiveStats;
  history: HistoryState;
}) {
  const cpuColor = pctColor(data.cpu.usagePercent);
  const memColor = pctColor(data.memory.usedPercent);
  const rootDisk =
    data.disk.mounts.find((m) => m.mountpoint === "/") ??
    data.disk.mounts[0] ??
    null;
  const diskColor = rootDisk ? pctColor(rootDisk.usedPercent) : pctColor(0);
  const totalRx = data.network.interfaces.reduce(
    (s, i) => s + i.rxBytesPerSec,
    0,
  );
  const totalTx = data.network.interfaces.reduce(
    (s, i) => s + i.txBytesPerSec,
    0,
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <OverviewCard
        label="CPU"
        Icon={Cpu}
        primary={`${data.cpu.usagePercent.toFixed(1)}%`}
        primaryClass={cpuColor.text}
        hint={`${data.cpu.cores} cores · load ${data.cpu.loadAvg["1m"].toFixed(2)}`}
        sparkValues={history.cpu}
        sparkMin={0}
        sparkMax={100}
        sparkColor="text-indigo-400"
      />
      <OverviewCard
        label="Memory"
        Icon={MemoryStick}
        primary={`${data.memory.usedPercent.toFixed(1)}%`}
        primaryClass={memColor.text}
        hint={`${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`}
        sparkValues={history.memory}
        sparkMin={0}
        sparkMax={100}
        sparkColor="text-emerald-400"
      />
      <OverviewCard
        label="Disk"
        Icon={HardDrive}
        primary={
          rootDisk ? `${rootDisk.usedPercent.toFixed(0)}%` : "—"
        }
        primaryClass={diskColor.text}
        hint={
          rootDisk
            ? `${formatBytes(rootDisk.usedBytes)} / ${formatBytes(rootDisk.totalBytes)} on ${rootDisk.mountpoint}`
            : "no host mounts"
        }
        sparkValues={[]}
        sparkColor=""
      />
      <OverviewCard
        label="Network"
        Icon={Network}
        primary={formatBitsPerSec(totalRx + totalTx)}
        primaryClass="text-purple-300"
        hint={
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-0.5">
              <ArrowDownToLine className="w-3 h-3" /> {formatBitsPerSec(totalRx)}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <ArrowUpFromLine className="w-3 h-3" /> {formatBitsPerSec(totalTx)}
            </span>
          </span>
        }
        sparkValues={history.rxBytesPerSec}
        sparkColor="text-purple-400"
      />
      <div className="card p-5 sm:col-span-2 lg:col-span-4 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2 text-slate-400">
          <Clock className="w-4 h-4" />
          <span>Uptime</span>
          <b className="text-slate-200 font-mono">
            {formatUptime(data.uptimeSeconds)}
          </b>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span>Load avg</span>
          <code className="text-slate-200">
            {data.cpu.loadAvg["1m"].toFixed(2)} ·{" "}
            {data.cpu.loadAvg["5m"].toFixed(2)} ·{" "}
            {data.cpu.loadAvg["15m"].toFixed(2)}
          </code>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span>Last sample</span>
          <code className="text-slate-500 text-xs">
            {new Date(data.timestamp).toLocaleTimeString()}
          </code>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  Icon,
  primary,
  primaryClass,
  hint,
  sparkValues,
  sparkMin,
  sparkMax,
  sparkColor,
}: {
  label: string;
  Icon: typeof Cpu;
  primary: string;
  primaryClass: string;
  hint: React.ReactNode;
  sparkValues: number[];
  sparkMin?: number;
  sparkMax?: number;
  sparkColor: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <Icon className="w-4 h-4 text-slate-500" />
      </div>
      <div className={`text-3xl font-semibold tabular-nums ${primaryClass}`}>
        {primary}
      </div>
      <div className="text-xs text-slate-500 mt-1 min-h-[1rem]">{hint}</div>
      {sparkValues.length > 1 && (
        <Sparkline
          values={sparkValues}
          min={sparkMin}
          max={sparkMax}
          width={260}
          height={36}
          className={`mt-2 w-full ${sparkColor}`}
          stroke="currentColor"
        />
      )}
    </div>
  );
}

function CpuSection({
  data,
  history,
}: {
  data: SystemLiveStats;
  history: number[];
}) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-300" />
          CPU
        </h2>
        <span className="text-xs text-slate-500">
          {data.cpu.cores} {data.cpu.cores === 1 ? "core" : "cores"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span
              className={`text-4xl font-semibold tabular-nums ${pctColor(data.cpu.usagePercent).text}`}
            >
              {data.cpu.usagePercent.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500">
              load: {data.cpu.loadAvg["1m"].toFixed(2)} (1m) ·{" "}
              {data.cpu.loadAvg["5m"].toFixed(2)} (5m) ·{" "}
              {data.cpu.loadAvg["15m"].toFixed(2)} (15m)
            </span>
          </div>
          <Sparkline
            values={history}
            min={0}
            max={100}
            width={800}
            height={64}
            stroke="currentColor"
            fill="rgba(99, 102, 241, 0.15)"
            className="w-full text-indigo-400"
          />
        </div>
      </div>

      {data.cpu.perCorePercent.length > 1 && (
        <div className="mt-4">
          <div className="text-xs text-slate-500 mb-2">Per-core</div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            {data.cpu.perCorePercent.map((p, i) => {
              const c = pctColor(p);
              return (
                <div
                  key={i}
                  className="bg-slate-950 border border-slate-800 rounded p-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-mono">cpu{i}</span>
                    <span className={`tabular-nums ${c.text}`}>
                      {p.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 mt-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${c.bar} transition-all duration-200`}
                      style={{ width: `${Math.min(100, p)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function MemorySection({
  data,
  history,
}: {
  data: SystemLiveStats;
  history: number[];
}) {
  const m = data.memory;
  const usedColor = pctColor(m.usedPercent);
  // Visual breakdown of memory: used (excl cache), cached/buffers, free.
  const trueUsed = Math.max(0, m.usedBytes - m.cachedBytes - m.bufferedBytes);
  const cachedAndBuffered = m.cachedBytes + m.bufferedBytes;
  const free = Math.max(0, m.totalBytes - trueUsed - cachedAndBuffered);

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
        <MemoryStick className="w-4 h-4 text-emerald-300" />
        Memory
      </h2>

      <div className="flex items-baseline gap-3 mb-2">
        <span
          className={`text-4xl font-semibold tabular-nums ${usedColor.text}`}
        >
          {m.usedPercent.toFixed(1)}%
        </span>
        <span className="text-sm text-slate-400 tabular-nums">
          {formatBytes(m.usedBytes)} / {formatBytes(m.totalBytes)} used
        </span>
      </div>

      <div className="h-3 bg-slate-950 border border-slate-800 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-emerald-500 transition-all duration-200"
          style={{ width: `${(trueUsed / m.totalBytes) * 100}%` }}
          title={`App memory: ${formatBytes(trueUsed)}`}
        />
        <div
          className="h-full bg-emerald-700/50 transition-all duration-200"
          style={{ width: `${(cachedAndBuffered / m.totalBytes) * 100}%` }}
          title={`Cache + buffers: ${formatBytes(cachedAndBuffered)}`}
        />
        <div
          className="h-full bg-slate-800 transition-all duration-200"
          style={{ width: `${(free / m.totalBytes) * 100}%` }}
          title={`Free: ${formatBytes(free)}`}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
        <Breakdown
          color="bg-emerald-500"
          label="App"
          value={formatBytes(trueUsed)}
        />
        <Breakdown
          color="bg-emerald-700/50"
          label="Cache + buffers"
          value={formatBytes(cachedAndBuffered)}
        />
        <Breakdown
          color="bg-slate-800"
          label="Free"
          value={formatBytes(m.availableBytes)}
          hint="available"
        />
        <Breakdown
          color="bg-amber-500"
          label="Swap"
          value={
            m.swapTotalBytes > 0
              ? `${formatBytes(m.swapUsedBytes)} / ${formatBytes(m.swapTotalBytes)}`
              : "disabled"
          }
        />
      </div>

      <Sparkline
        values={history}
        min={0}
        max={100}
        width={800}
        height={48}
        stroke="currentColor"
        fill="rgba(16, 185, 129, 0.15)"
        className="w-full text-emerald-400 mt-4"
      />
    </section>
  );
}

function Breakdown({
  color,
  label,
  value,
  hint,
}: {
  color: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`w-2.5 h-2.5 rounded-sm mt-1 ${color}`} />
      <div>
        <div className="text-slate-500">{label}</div>
        <div className="text-slate-200 font-mono">{value}</div>
        {hint && <div className="text-slate-600 text-[10px]">{hint}</div>}
      </div>
    </div>
  );
}

function DiskSection({ mounts }: { mounts: SystemLiveStats["disk"]["mounts"] }) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-amber-300" />
        Disk
      </h2>
      {mounts.length === 0 ? (
        <div className="text-sm text-slate-500">
          No host mounts visible. Is the privileged{" "}
          <code className="bg-slate-900 px-1 rounded">panel_host</code> sidecar
          running with <code>/:/host</code> bind mount?
        </div>
      ) : (
        <div className="space-y-3">
          {mounts.map((m) => {
            const c = pctColor(m.usedPercent);
            return (
              <div
                key={m.mountpoint}
                className="bg-slate-950 border border-slate-800 rounded p-3"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <span className="font-mono text-sm">{m.mountpoint}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {m.type} · {m.filesystem}
                    </span>
                  </div>
                  <div className="text-sm tabular-nums shrink-0">
                    <span className={c.text}>{m.usedPercent.toFixed(1)}%</span>
                    <span className="text-slate-500 text-xs ml-2">
                      {formatBytes(m.usedBytes)} / {formatBytes(m.totalBytes)}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${c.bar} transition-all duration-300`}
                    style={{ width: `${Math.min(100, m.usedPercent)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NetworkSection({
  interfaces,
  rxHistory,
  txHistory,
}: {
  interfaces: SystemLiveStats["network"]["interfaces"];
  rxHistory: number[];
  txHistory: number[];
}) {
  const totalRx = interfaces.reduce((s, i) => s + i.rxBytesPerSec, 0);
  const totalTx = interfaces.reduce((s, i) => s + i.txBytesPerSec, 0);

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
        <Network className="w-4 h-4 text-purple-300" />
        Network
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <NetworkSparkCard
          label="↓ Download"
          Icon={ArrowDownToLine}
          current={totalRx}
          values={rxHistory}
          color="text-cyan-400"
          fill="rgba(34, 211, 238, 0.15)"
        />
        <NetworkSparkCard
          label="↑ Upload"
          Icon={ArrowUpFromLine}
          current={totalTx}
          values={txHistory}
          color="text-purple-400"
          fill="rgba(168, 85, 247, 0.15)"
        />
      </div>

      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-900/40">
            <tr>
              <th className="px-4 py-2 font-medium">Interface</th>
              <th className="px-4 py-2 font-medium text-right">↓ Rate</th>
              <th className="px-4 py-2 font-medium text-right">↑ Rate</th>
              <th className="px-4 py-2 font-medium text-right">↓ Total</th>
              <th className="px-4 py-2 font-medium text-right">↑ Total</th>
            </tr>
          </thead>
          <tbody>
            {interfaces.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-3 text-slate-500 text-center text-xs"
                >
                  No interfaces detected.
                </td>
              </tr>
            ) : (
              interfaces.map((iface) => (
                <tr
                  key={iface.name}
                  className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-2 font-mono">{iface.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-cyan-300">
                    {formatBitsPerSec(iface.rxBytesPerSec)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-purple-300">
                    {formatBitsPerSec(iface.txBytesPerSec)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400 text-xs">
                    {formatBytes(iface.rxBytesTotal)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400 text-xs">
                    {formatBytes(iface.txBytesTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NetworkSparkCard({
  label,
  Icon,
  current,
  values,
  color,
  fill,
}: {
  label: string;
  Icon: typeof ArrowDownToLine;
  current: number;
  values: number[];
  color: string;
  fill: string;
}) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>
        {formatBitsPerSec(current)}
      </div>
      <Sparkline
        values={values}
        min={0}
        width={400}
        height={40}
        stroke="currentColor"
        fill={fill}
        className={`w-full mt-2 ${color}`}
      />
    </div>
  );
}
