import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Boxes,
  Container,
  GitBranch,
  CheckCircle2,
  XCircle,
  Activity,
  Globe,
  Hammer,
  Cpu,
  MemoryStick,
  HardDrive,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";
import { StatCard } from "../components/stat-card";

interface AppRow {
  id: string;
  slug: string;
  description: string | null;
  imageRef: string | null;
  sourceType: string;
  buildMode: string | null;
  createdAt: string;
  deployments: Array<{
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
  }>;
}

interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actor: { id: string; email: string } | null;
}

interface HostStats {
  docker: {
    version: string;
    containers: number;
    containersRunning: number;
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
    imagesCount: number;
    imagesSize: number;
    containersSize: number;
    volumesSize: number;
    buildCacheSize: number;
    total: number;
  };
}

interface ContainerStatsRow {
  id: string;
  name: string;
  image: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function DashboardPage() {
  const apps = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<AppRow[]>("/apps"),
    refetchInterval: 8000,
  });
  const containers = useQuery({
    queryKey: ["containers"],
    queryFn: () => api<ContainerSummary[]>("/containers"),
    refetchInterval: 8000,
  });
  const audit = useQuery({
    queryKey: ["audit-recent"],
    queryFn: () =>
      api<{ items: AuditEntry[]; nextCursor: string | null }>(
        "/audit?limit=10",
      ),
    refetchInterval: 8000,
  });
  const hostStats = useQuery({
    queryKey: ["stats-host"],
    queryFn: () => api<HostStats>("/stats/host"),
    refetchInterval: 15000,
  });
  const containerStats = useQuery({
    queryKey: ["stats-containers"],
    queryFn: () =>
      api<{ rows: ContainerStatsRow[] }>("/stats/containers?limit=10"),
    refetchInterval: 10000,
  });

  const totalApps = apps.data?.length ?? 0;
  const gitApps =
    apps.data?.filter((a) => a.sourceType === "git-repo").length ?? 0;
  const totalContainers = containers.data?.length ?? 0;
  const runningContainers =
    containers.data?.filter((c) => c.state === "running").length ?? 0;

  // Latest deployment per app
  const latestDeploys = (apps.data ?? [])
    .map((a) => ({ app: a, dep: a.deployments[0] }))
    .filter((x) => x.dep)
    .sort(
      (a, b) =>
        new Date(b.dep!.startedAt).getTime() -
        new Date(a.dep!.startedAt).getTime(),
    )
    .slice(0, 6);

  const recentSuccess = latestDeploys.filter(
    (d) => d.dep!.status === "succeeded",
  ).length;
  const recentFailed = latestDeploys.filter(
    (d) => d.dep!.status === "failed",
  ).length;

  return (
    <Layout
      title="Dashboard"
      subtitle="Overview of your panel-managed apps and containers"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Apps"
          value={totalApps}
          Icon={Boxes}
          accent="indigo"
          hint={`${gitApps} git-backed`}
        />
        <StatCard
          label="Containers"
          value={`${runningContainers} / ${totalContainers}`}
          Icon={Container}
          accent="green"
          hint="running / total"
        />
        <StatCard
          label="Recent deploys"
          value={`${recentSuccess} ✓`}
          Icon={CheckCircle2}
          accent={recentFailed > 0 ? "amber" : "green"}
          hint={
            recentFailed > 0
              ? `${recentFailed} failed in last 6`
              : "all healthy"
          }
        />
        <StatCard
          label="Audit events"
          value={audit.data?.items.length ?? 0}
          Icon={Activity}
          accent="slate"
          hint="last 10 visible"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Recent deployments
            </h2>
            <Link
              to="/apps"
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              all apps →
            </Link>
          </div>
          {apps.isLoading ? (
            <div className="p-5 text-slate-500 text-sm">Loading…</div>
          ) : latestDeploys.length === 0 ? (
            <div className="p-5 text-slate-500 text-sm">
              No deployments yet. Create an app to get started.
            </div>
          ) : (
            <ul>
              {latestDeploys.map(({ app, dep }) => (
                <li
                  key={app.id}
                  className="px-5 py-3 border-b border-slate-800 last:border-b-0 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {app.sourceType === "git-repo" ? (
                      <GitBranch className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : (
                      <Hammer className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <Link
                      to={`/apps/${app.id}`}
                      className="font-mono text-sm hover:text-indigo-300 truncate"
                    >
                      {app.slug}
                    </Link>
                    {app.buildMode && (
                      <span className="text-xs text-slate-500">
                        ({app.buildMode})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {dep!.status === "succeeded" ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        succeeded
                      </span>
                    ) : dep!.status === "failed" ? (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="w-3.5 h-3.5" />
                        failed
                      </span>
                    ) : (
                      <span className="text-xs text-amber-400">
                        {dep!.status}
                      </span>
                    )}
                    <span className="text-xs text-slate-500 tabular-nums">
                      {timeAgo(dep!.startedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Activity
            </h2>
            <Link
              to="/audit"
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              full log →
            </Link>
          </div>
          {audit.isLoading ? (
            <div className="p-5 text-slate-500 text-sm">Loading…</div>
          ) : (audit.data?.items.length ?? 0) === 0 ? (
            <div className="p-5 text-slate-500 text-sm">No activity yet.</div>
          ) : (
            <ul>
              {audit.data!.items.slice(0, 8).map((e) => (
                <li
                  key={e.id}
                  className="px-5 py-3 border-b border-slate-800 last:border-b-0 text-xs"
                >
                  <div className="font-mono text-slate-300 truncate">
                    {e.action}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    {e.actor?.email ?? "(unauth)"} · {timeAgo(e.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="card lg:col-span-1">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Host
            </h2>
          </div>
          {hostStats.isLoading ? (
            <div className="p-5 text-slate-500 text-sm">Loading…</div>
          ) : hostStats.data ? (
            <div className="p-5 space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                  <Cpu className="w-4 h-4 text-indigo-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">CPU cores</div>
                  <div className="tabular-nums">{hostStats.data.host.cpus}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-600/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <MemoryStick className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">RAM</div>
                  <div className="tabular-nums">
                    {formatBytes(hostStats.data.host.memoryBytes)}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-600/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <HardDrive className="w-4 h-4 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">Docker disk usage</div>
                  <div className="tabular-nums">
                    {formatBytes(hostStats.data.disk.total)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Images ({hostStats.data.disk.imagesCount})</span>
                      <span className="font-mono">
                        {formatBytes(hostStats.data.disk.imagesSize)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Containers</span>
                      <span className="font-mono">
                        {formatBytes(hostStats.data.disk.containersSize)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Volumes</span>
                      <span className="font-mono">
                        {formatBytes(hostStats.data.disk.volumesSize)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Build cache</span>
                      <span className="font-mono">
                        {formatBytes(hostStats.data.disk.buildCacheSize)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800 text-xs text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>Docker</span>
                  <span className="font-mono">
                    {hostStats.data.docker.version}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>OS</span>
                  <span className="font-mono truncate ml-3">
                    {hostStats.data.host.os}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Arch</span>
                  <span className="font-mono">{hostStats.data.host.arch}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 text-red-400 text-sm">
              {(hostStats.error as Error)?.message ?? "Failed to load host stats"}
            </div>
          )}
        </div>

        <div className="card lg:col-span-2">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Resource usage
            </h2>
            <span className="text-xs text-slate-500">
              top by memory · refreshes every 10s
            </span>
          </div>
          {containerStats.isLoading ? (
            <div className="p-5 text-slate-500 text-sm">Sampling…</div>
          ) : (containerStats.data?.rows.length ?? 0) === 0 ? (
            <div className="p-5 text-slate-500 text-sm">
              No running containers.
            </div>
          ) : (
            <ul>
              {containerStats.data!.rows.map((r) => (
                <li
                  key={r.id}
                  className="px-5 py-3 border-b border-slate-800 last:border-b-0"
                >
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-mono truncate min-w-0">
                      {r.name}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums ml-3 shrink-0">
                      {r.cpuPercent.toFixed(1)}% CPU ·{" "}
                      {formatBytes(r.memoryBytes)}
                      {r.memoryLimitBytes > 0 &&
                        ` / ${formatBytes(r.memoryLimitBytes)}`}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                    <div
                      className={
                        r.memoryPercent > 80
                          ? "h-full bg-red-500/60"
                          : r.memoryPercent > 50
                            ? "h-full bg-amber-500/60"
                            : "h-full bg-emerald-500/60"
                      }
                      style={{
                        width: `${Math.min(100, Math.max(2, r.memoryPercent))}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Running containers
            </h2>
          </div>
          {containers.isLoading ? (
            <div className="p-5 text-slate-500 text-sm">Loading…</div>
          ) : runningContainers === 0 ? (
            <div className="p-5 text-slate-500 text-sm">
              No containers running.
            </div>
          ) : (
            <ul>
              {containers
                .data!.filter((c) => c.state === "running")
                .slice(0, 6)
                .map((c) => (
                  <li
                    key={c.id}
                    className="px-5 py-3 border-b border-slate-800 last:border-b-0 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="font-mono truncate">{c.name}</span>
                    </div>
                    <span className="text-slate-500 truncate ml-3">
                      {c.image}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Quick links
            </h2>
          </div>
          <div className="p-5 grid grid-cols-2 gap-3 text-sm">
            <Link
              to="/apps"
              className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 hover:border-indigo-500/40 hover:bg-indigo-600/10 transition-colors"
            >
              <Boxes className="w-4 h-4 text-indigo-400" />
              Manage apps
            </Link>
            <Link
              to="/containers"
              className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 hover:border-indigo-500/40 hover:bg-indigo-600/10 transition-colors"
            >
              <Container className="w-4 h-4 text-indigo-400" />
              Containers
            </Link>
            <Link
              to="/audit"
              className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 hover:border-indigo-500/40 hover:bg-indigo-600/10 transition-colors"
            >
              <Activity className="w-4 h-4 text-indigo-400" />
              Audit log
            </Link>
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 p-3 rounded-lg border border-slate-800 hover:border-indigo-500/40 hover:bg-indigo-600/10 transition-colors"
            >
              <Globe className="w-4 h-4 text-indigo-400" />
              Docs (PRD.md)
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
