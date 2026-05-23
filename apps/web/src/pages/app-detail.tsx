import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Layout } from "../components/layout";
import { TerminalView } from "../components/terminal-view";
import { LogStreamView } from "../components/log-stream-view";
import { Drawer } from "../components/drawer";

interface EnvVar {
  id: string;
  key: string;
  isSecret: boolean;
  value: string | null;
}

interface Deployment {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  imageTag: string;
  log: string | null;
  trigger?: string | null;
  commitMessage?: string | null;
}

interface Domain {
  id: string;
  hostname: string;
  port: number;
  serviceName: string | null;
  sslEnabled: boolean;
  certExpiresAt: string | null;
}

interface AppDetail {
  id: string;
  slug: string;
  project: { id: string; slug: string; name: string } | null;
  description: string | null;
  sourceType: "prebuilt-image" | "git-repo";
  buildMode: "dockerfile" | "static" | "compose" | null;
  imageRef: string | null;
  repoUrl: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  composePath: string | null;
  githubRepoFullName: string | null;
  githubInstallationId: string | null;
  webhookSecret: string | null;
  runtimeConfig: {
    ports?: Array<{ host: number; container: number; proto?: string }>;
    restartPolicy?: string;
  } | null;
  envVars: Array<{ id: string; key: string; isSecret: boolean }>;
  domains: Domain[];
  deployments: Deployment[];
}

interface EnvRow {
  key: string;
  value: string;
  isSecret: boolean;
}

type SectionKey =
  | "general"
  | "source"
  | "env"
  | "domains"
  | "webhook"
  | "logs"
  | "terminal"
  | "deployments"
  | "danger";

interface SectionEntry {
  key: SectionKey;
  label: string;
  show: (a: AppDetail) => boolean;
}

const SECTIONS: SectionEntry[] = [
  { key: "general", label: "General", show: () => true },
  {
    key: "source",
    label: "Source",
    show: (a) => a.sourceType === "git-repo",
  },
  { key: "env", label: "Environment Variables", show: () => true },
  { key: "domains", label: "Domains", show: () => true },
  {
    key: "webhook",
    label: "Webhook",
    show: (a) => a.sourceType === "git-repo",
  },
  { key: "logs", label: "Logs", show: () => true },
  { key: "terminal", label: "Terminal", show: () => true },
  { key: "deployments", label: "Deployments", show: () => true },
  { key: "danger", label: "Danger Zone", show: () => true },
];

const VALID_SECTIONS = new Set<string>(SECTIONS.map((s) => s.key));

function isSectionKey(v: string | null): v is SectionKey {
  return v !== null && VALID_SECTIONS.has(v);
}

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["app", id],
    queryFn: () => api<AppDetail>(`/apps/${id}`),
    refetchInterval: 4000,
  });

  const sectionParam = searchParams.get("section");
  const activeSection: SectionKey = isSectionKey(sectionParam)
    ? sectionParam
    : "general";

  function setSection(s: SectionKey) {
    const next = new URLSearchParams(searchParams);
    next.set("section", s);
    setSearchParams(next, { replace: true });
  }

  const deploy = useMutation({
    mutationFn: () => api(`/apps/${id}/deploy`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", id] }),
  });

  const stop = useMutation({
    mutationFn: () => api(`/apps/${id}/stop`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", id] }),
  });

  if (isLoading) {
    return (
      <Layout title="Loading…">
        <div className="text-slate-400">Loading app…</div>
      </Layout>
    );
  }
  if (error || !data) {
    return (
      <Layout title="Not found">
        <div className="text-red-400">
          {error ? (error as Error).message : "App not found"}
        </div>
      </Layout>
    );
  }

  const visibleSections = SECTIONS.filter((s) => s.show(data));
  // Auto-fall back to "general" if the chosen section isn't valid for this
  // app type (e.g. ?section=source on a prebuilt-image app).
  const resolvedSection: SectionKey = visibleSections.some(
    (s) => s.key === activeSection,
  )
    ? activeSection
    : "general";

  return (
    <Layout
      title={data.slug}
      subtitle={
        data.sourceType === "git-repo"
          ? `${data.buildMode ?? "git"} · ${data.repoUrl ?? ""}${data.branch ? ` @ ${data.branch}` : ""}`
          : `prebuilt image · ${data.imageRef ?? ""}`
      }
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={data.project ? `/projects/${data.project.id}` : "/apps"}
            className="text-sm text-slate-400 hover:text-white px-3 py-2"
          >
            ← {data.project?.name ?? "Apps"}
          </Link>
          <button
            onClick={() => deploy.mutate()}
            disabled={deploy.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {deploy.isPending
              ? data.sourceType === "git-repo"
                ? "Building…"
                : "Deploying…"
              : data.sourceType === "git-repo"
                ? "Build & Deploy"
                : "Deploy"}
          </button>
          <button
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className="bg-amber-700/30 hover:bg-amber-700/50 border border-amber-700/40 text-amber-200 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      }
    >
      {deploy.error && (
        <div className="bg-red-900/50 border border-red-800 rounded p-3 text-sm text-red-200 mb-4">
          Deploy failed: {(deploy.error as Error).message}
        </div>
      )}

      <div className="flex gap-6">
        <aside className="w-56 shrink-0">
          <nav className="space-y-0.5 sticky top-4">
            {visibleSections.map((s) => {
              const active = s.key === resolvedSection;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors " +
                    (active
                      ? "bg-indigo-600/20 text-indigo-200 border border-indigo-600/40"
                      : s.key === "danger"
                        ? "text-red-300/70 hover:bg-red-900/20 hover:text-red-200 border border-transparent"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent")
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 space-y-6">
          {resolvedSection === "general" && <GeneralSection app={data} />}
          {resolvedSection === "source" && <SourceSection app={data} />}
          {resolvedSection === "env" && <EnvVarsSection appId={data.id} />}
          {resolvedSection === "domains" && (
            <DomainsSection
              appId={data.id}
              domains={data.domains}
              isCompose={
                data.sourceType === "git-repo" &&
                (data.buildMode ?? null) === "compose"
              }
            />
          )}
          {resolvedSection === "webhook" && (
            <WebhookSection
              appId={data.id}
              webhookSecret={data.webhookSecret ?? null}
              branch={data.branch ?? "main"}
            />
          )}
          {resolvedSection === "logs" && <LogsSection appId={data.id} />}
          {resolvedSection === "terminal" && (
            <TerminalSection appId={data.id} />
          )}
          {resolvedSection === "deployments" && (
            <DeploymentsSection
              appId={data.id}
              deployments={data.deployments}
              buildMode={data.buildMode}
              ports={data.runtimeConfig?.ports ?? []}
            />
          )}
          {resolvedSection === "danger" && (
            <DangerZoneSection
              appId={data.id}
              slug={data.slug}
              onDeleted={() => nav("/apps")}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

// ============================================================================
// Environment variables — table view + developer (textarea) view for bulk paste.
// ============================================================================

function parseEnvText(text: string, existing: EnvRow[]): EnvRow[] {
  const existingMap = new Map(existing.map((r) => [r.key, r]));
  const rows: EnvRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    let value = line.slice(eq + 1);
    // Strip surrounding single/double quotes.
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    // Strip inline " #comment" suffix (with a leading space — values can
    // legitimately contain "#"). Matches what dotenv-style parsers do.
    const hashIdx = value.indexOf(" #");
    if (hashIdx > -1) value = value.slice(0, hashIdx).trimEnd();
    rows.push({
      key,
      value,
      isSecret: existingMap.get(key)?.isSecret ?? false,
    });
  }
  return rows;
}

function rowsToText(rows: EnvRow[]): string {
  return rows
    .filter((r) => r.key)
    .map((r) => `${r.key}=${r.value}`)
    .join("\n");
}

function EnvVarsSection({ appId }: { appId: string }) {
  const qc = useQueryClient();

  const envQuery = useQuery({
    queryKey: ["app-env", appId],
    queryFn: () => api<EnvVar[]>(`/apps/${appId}/env`),
  });

  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [devView, setDevView] = useState(false);
  const [devText, setDevText] = useState("");

  const serverRows = useMemo<EnvRow[]>(
    () =>
      (envQuery.data ?? []).map((v) => ({
        key: v.key,
        value: v.value ?? "",
        isSecret: v.isSecret,
      })),
    [envQuery.data],
  );

  // Reset local state whenever server data changes.
  useEffect(() => {
    setEnvRows(serverRows);
    setDevText(rowsToText(serverRows));
  }, [serverRows]);

  // When user types in developer view, parse continuously into envRows so
  // the dirty-check + Save flow stays the same.
  function updateDevText(next: string) {
    setDevText(next);
    setEnvRows(parseEnvText(next, envRows));
  }

  // When switching modes, sync the other view from current data.
  function switchView(toDev: boolean) {
    if (toDev) {
      setDevText(rowsToText(envRows));
    } else {
      setEnvRows(parseEnvText(devText, envRows));
    }
    setDevView(toDev);
  }

  const envDirty = useMemo(() => {
    if (serverRows.length !== envRows.length) return true;
    for (let i = 0; i < serverRows.length; i++) {
      const s = serverRows[i]!;
      const r = envRows[i]!;
      if (s.key !== r.key || s.value !== r.value || s.isSecret !== r.isSecret) {
        return true;
      }
    }
    return false;
  }, [envRows, serverRows]);

  const saveEnv = useMutation({
    mutationFn: () =>
      api(`/apps/${appId}/env`, {
        method: "PUT",
        body: JSON.stringify({ vars: envRows }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-env", appId] }),
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold">Environment variables</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Secrets are AES-256-GCM encrypted at rest. Click <b>Save</b> then
            redeploy for changes to take effect.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-lg overflow-hidden border border-slate-700 text-xs">
            <button
              onClick={() => switchView(false)}
              className={
                "px-2.5 py-1 " +
                (!devView
                  ? "bg-slate-700 text-slate-100"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200")
              }
            >
              Normal
            </button>
            <button
              onClick={() => switchView(true)}
              className={
                "px-2.5 py-1 " +
                (devView
                  ? "bg-slate-700 text-slate-100"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200")
              }
              title="Paste a .env file all at once"
            >
              Developer
            </button>
          </div>
          {!devView && (
            <button
              onClick={() =>
                setEnvRows([
                  ...envRows,
                  { key: "", value: "", isSecret: false },
                ])
              }
              className="text-sm bg-slate-800 hover:bg-slate-700 rounded px-3 py-1"
            >
              + Add
            </button>
          )}
          {envDirty && (
            <button
              onClick={() => saveEnv.mutate()}
              disabled={saveEnv.isPending}
              className="text-sm bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1 disabled:opacity-50"
            >
              {saveEnv.isPending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {devView ? (
        <div>
          <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-lg p-3 mb-2 text-xs text-indigo-200">
            Paste a <code>.env</code>-style block. One{" "}
            <code>KEY=value</code> per line. Lines starting with{" "}
            <code>#</code> and inline <code> #comment</code> suffixes are
            stripped. Surrounding quotes around values are removed.
          </div>
          <textarea
            value={devText}
            onChange={(e) => updateDevText(e.target.value)}
            spellCheck={false}
            rows={Math.max(8, Math.min(devText.split("\n").length + 1, 30))}
            placeholder={"DATABASE_URL=postgres://...\nSTRIPE_KEY=sk_test_...\nNODE_ENV=production"}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-xs"
          />
          <p className="text-xs text-slate-500 mt-1">
            Switch back to <b>Normal</b> view to flag specific keys as
            secrets (encrypted at rest, hidden in UI).
          </p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded">
          {envRows.length === 0 && (
            <div className="text-slate-500 text-sm p-4">
              No env vars set. Click <b>+ Add</b> or switch to{" "}
              <b>Developer</b> view to paste a .env file.
            </div>
          )}
          {envRows.map((row, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2 border-b border-slate-800 last:border-b-0"
            >
              <input
                value={row.key}
                onChange={(e) => {
                  const next = [...envRows];
                  next[i] = {
                    ...next[i]!,
                    key: e.target.value.toUpperCase(),
                  };
                  setEnvRows(next);
                }}
                placeholder="KEY"
                className="bg-slate-800 rounded px-2 py-1 font-mono text-sm w-48"
              />
              <input
                value={row.value}
                onChange={(e) => {
                  const next = [...envRows];
                  next[i] = { ...next[i]!, value: e.target.value };
                  setEnvRows(next);
                }}
                type={row.isSecret ? "password" : "text"}
                placeholder="value"
                className="flex-1 bg-slate-800 rounded px-2 py-1 font-mono text-sm"
              />
              <label className="text-xs text-slate-400 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={row.isSecret}
                  onChange={(e) => {
                    const next = [...envRows];
                    next[i] = { ...next[i]!, isSecret: e.target.checked };
                    setEnvRows(next);
                  }}
                />
                secret
              </label>
              <button
                onClick={() => setEnvRows(envRows.filter((_, j) => j !== i))}
                className="text-slate-500 hover:text-red-400 px-2"
                aria-label="Remove row"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {envDirty && (
        <div className="text-xs text-amber-400 mt-2">
          Unsaved changes. Click <b>Save</b>, then redeploy to apply.
        </div>
      )}
      {saveEnv.error && (
        <div className="text-xs text-red-400 mt-2">
          {(saveEnv.error as Error).message}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Deployments — extracted from the inline render so it lives in its own tab.
// ============================================================================

function DeploymentsSection({
  appId,
  deployments,
  buildMode,
  ports,
}: {
  appId: string;
  deployments: Deployment[];
  buildMode: AppDetail["buildMode"];
  ports: Array<{ host: number; container: number; proto?: string }>;
}) {
  const qc = useQueryClient();
  const redeploy = useMutation({
    mutationFn: (deploymentId: string) =>
      api(`/apps/${appId}/deployments/${deploymentId}/redeploy`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", appId] }),
  });

  const isCompose = buildMode === "compose";
  const latest = deployments[0];

  // The selected deployment opens in a right-side drawer with full logs.
  // We track by id so the drawer survives parent re-renders (polling every
  // 4s would otherwise close it on each refresh if we kept the whole object).
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = openId
    ? deployments.find((d) => d.id === openId) ?? null
    : null;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Deployment history</h2>
      <div className="bg-slate-900 border border-slate-800 rounded">
        {deployments.length === 0 && (
          <div className="text-slate-500 text-sm p-4">
            No deployments yet.
          </div>
        )}
        {deployments.map((d, idx) => {
          const isLatest = idx === 0;
          const canRedeploy =
            d.status === "succeeded" &&
            d.imageTag &&
            d.imageTag !== "(pending)" &&
            !isCompose;
          return (
            <button
              type="button"
              key={d.id}
              onClick={() => setOpenId(d.id)}
              className="w-full text-left p-3 flex items-center justify-between gap-3 border-b border-slate-800 last:border-b-0 hover:bg-slate-800/40 transition-colors"
            >
              <span className="text-sm flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={
                    d.status === "succeeded"
                      ? "text-green-400"
                      : d.status === "failed"
                        ? "text-red-400"
                        : "text-amber-400"
                  }
                >
                  {d.status}
                </span>
                {d.trigger && d.trigger !== "manual" && (
                  <span
                    className={
                      d.trigger === "webhook"
                        ? "text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded"
                        : "text-xs bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded"
                    }
                  >
                    {d.trigger}
                  </span>
                )}
                {isLatest && (
                  <span className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                    current
                  </span>
                )}
                <span className="font-mono text-slate-400 text-xs truncate">
                  {d.imageTag}
                </span>
                {d.commitMessage && (
                  <span className="text-xs text-slate-500 truncate">
                    — {d.commitMessage}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">
                  {new Date(d.startedAt).toLocaleString()}
                </span>
                {canRedeploy && !isLatest && (
                  // Inner button — stop propagation so the row click doesn't
                  // also open the drawer when the user really meant "redeploy".
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(
                          `Roll back to image "${d.imageTag}"? Current container will be stopped and replaced.`,
                        )
                      ) {
                        redeploy.mutate(d.id);
                      }
                    }}
                    disabled={redeploy.isPending}
                    className="text-xs bg-amber-800 hover:bg-amber-700 rounded px-2 py-0.5 disabled:opacity-50"
                    title="Roll back to this image"
                  >
                    Redeploy
                  </button>
                )}
                {isCompose && d.status === "succeeded" && (
                  <span
                    className="text-xs text-slate-600"
                    title="Compose apps can't be rolled back from history — push a fix commit or change the watched branch."
                  >
                    —
                  </span>
                )}
                <span className="text-slate-500 text-xs">→</span>
              </span>
            </button>
          );
        })}
      </div>

      {latest?.status === "succeeded" && ports[0] && (
        <div className="text-sm text-slate-400 mt-3">
          App should be reachable at{" "}
          <a
            href={`http://localhost:${ports[0].host}`}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            http://localhost:{ports[0].host}
          </a>
        </div>
      )}

      <Drawer
        open={!!selected}
        onClose={() => setOpenId(null)}
        widthClass="max-w-3xl"
        title={
          selected
            ? `Deployment · ${selected.status}`
            : "Deployment"
        }
        subtitle={
          selected && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  selected.status === "succeeded"
                    ? "text-green-400"
                    : selected.status === "failed"
                      ? "text-red-400"
                      : "text-amber-400"
                }
              >
                ● {selected.status}
              </span>
              {selected.trigger && (
                <span
                  className={
                    selected.trigger === "webhook"
                      ? "text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded"
                      : selected.trigger === "manual"
                        ? "text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded"
                        : "text-xs bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded"
                  }
                >
                  {selected.trigger}
                </span>
              )}
              <span className="font-mono text-slate-400 text-xs">
                {selected.imageTag}
              </span>
              <span className="text-slate-500">
                started {new Date(selected.startedAt).toLocaleString()}
              </span>
              {selected.finishedAt && (
                <span className="text-slate-500">
                  · finished{" "}
                  {new Date(selected.finishedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col h-full">
            {selected.commitMessage && (
              <div className="px-4 py-3 border-b border-slate-800 text-sm bg-slate-950/50">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Commit
                </div>
                <div className="text-slate-200 whitespace-pre-wrap break-words">
                  {selected.commitMessage}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              {selected.log ? (
                <pre className="text-xs bg-slate-950 p-4 whitespace-pre-wrap break-words text-slate-300 font-mono leading-relaxed min-h-full">
                  {selected.log}
                </pre>
              ) : (
                <div className="p-4 text-sm text-slate-500">
                  No log captured for this deployment yet.
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}

// ============================================================================
// Logs — live container log stream. For compose apps with multiple services,
// shows a service selector so the user can flip between containers without
// leaving the page.
// ============================================================================

interface AppContainer {
  id: string;
  name: string;
  service: string;
  state: string;
  status: string;
  image: string;
}

function useAppContainers(appId: string) {
  return useQuery({
    queryKey: ["app-containers", appId],
    queryFn: () => api<AppContainer[]>(`/apps/${appId}/containers`),
    refetchInterval: 5000,
    retry: false,
  });
}

function ContainerPicker({
  containers,
  selectedId,
  onSelect,
}: {
  containers: AppContainer[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // Only render a picker when there's actually a choice to make — for the
  // single-container case (most non-compose apps) it's noise.
  if (containers.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 mb-3 text-xs">
      <span className="text-slate-500">Service:</span>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-slate-800 rounded px-2 py-1 font-mono"
      >
        {containers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.service} ({c.state})
          </option>
        ))}
      </select>
    </div>
  );
}

function LogsSection({ appId }: { appId: string }) {
  const containers = useAppContainers(appId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first running container. Re-pick if the previously
  // selected one disappears (e.g. service removed from compose).
  useEffect(() => {
    const list = containers.data ?? [];
    if (!list.length) return;
    if (selectedId && list.some((c) => c.id === selectedId)) return;
    const running = list.find((c) => c.state === "running") ?? list[0]!;
    setSelectedId(running.id);
  }, [containers.data, selectedId]);

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Logs</h2>

      {containers.isLoading && (
        <div className="text-sm text-slate-500">Loading containers…</div>
      )}
      {containers.error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
          {(containers.error as Error).message}
        </div>
      )}
      {containers.data && containers.data.length === 0 && (
        <div className="text-sm text-slate-500 bg-slate-900 border border-slate-800 rounded p-4">
          No container running for this app yet. Deploy it first.
        </div>
      )}

      {containers.data && selectedId && (
        <>
          <ContainerPicker
            containers={containers.data}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <LogStreamView
            containerId={selectedId}
            tail={500}
            height="calc(100vh - 320px)"
          />
        </>
      )}
    </section>
  );
}

// ============================================================================
// Terminal — interactive shell inside the app's container. For compose apps,
// lets the user pick which service to exec into.
// ============================================================================

function TerminalSection({ appId }: { appId: string }) {
  const containers = useAppContainers(appId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const list = containers.data ?? [];
    if (!list.length) return;
    if (selectedId && list.some((c) => c.id === selectedId)) return;
    // Terminal only makes sense for running containers — pick one.
    const running = list.find((c) => c.state === "running");
    if (running) setSelectedId(running.id);
  }, [containers.data, selectedId]);

  const running = containers.data?.filter((c) => c.state === "running") ?? [];

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Terminal</h2>

      {containers.isLoading && (
        <div className="text-sm text-slate-500">Loading containers…</div>
      )}
      {containers.error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
          {(containers.error as Error).message}
        </div>
      )}
      {containers.data && running.length === 0 && (
        <div className="text-sm text-slate-500 bg-slate-900 border border-slate-800 rounded p-4">
          No running container for this app. Start it via{" "}
          <b>Build &amp; Deploy</b> to open a shell here.
        </div>
      )}

      {running.length > 0 && selectedId && (
        <>
          <ContainerPicker
            containers={running}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <TerminalView
            containerId={selectedId}
            height="calc(100vh - 320px)"
          />
        </>
      )}
    </section>
  );
}

// ============================================================================
// Danger zone — destructive operations live behind a confirmation here, not
// in the top bar, so they can't be triggered by accident.
// ============================================================================

function DangerZoneSection({
  appId,
  slug,
  onDeleted,
}: {
  appId: string;
  slug: string;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/apps/${appId}`, { method: "DELETE" }),
    onSuccess: onDeleted,
  });

  const canDelete = confirmText === slug;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2 text-red-300">Danger zone</h2>
      <div className="bg-red-950/20 border border-red-900/50 rounded p-4 space-y-3">
        <div>
          <div className="font-medium text-red-200">Delete this app</div>
          <p className="text-xs text-slate-400 mt-1">
            Stops and removes the container, deletes nginx site configs for
            bound domains, removes env vars, and erases deployment history.
            <b className="text-red-300"> This cannot be undone.</b>
          </p>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Type <code className="bg-slate-900 px-1 rounded">{slug}</code> to
            confirm
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={slug}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono text-sm"
          />
        </div>
        {remove.error && (
          <div className="text-red-400 text-xs">
            {(remove.error as Error).message}
          </div>
        )}
        <button
          onClick={() => remove.mutate()}
          disabled={!canDelete || remove.isPending}
          className="bg-red-700 hover:bg-red-600 disabled:bg-red-900 disabled:text-red-400 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium"
        >
          {remove.isPending ? "Deleting…" : "Delete app"}
        </button>
      </div>
    </section>
  );
}

function DomainsSection({
  appId,
  domains,
  isCompose,
}: {
  appId: string;
  domains: Domain[];
  isCompose: boolean;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState("80");
  const [serviceName, setServiceName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // For compose apps, auto-detect services from docker-compose.yml so the
  // user picks from a dropdown instead of typing.
  const services = useQuery({
    queryKey: ["compose-services", appId],
    queryFn: () =>
      api<{
        services: Array<{ name: string; image: string | null; ports: number[] }>;
      }>(`/apps/${appId}/compose/services`),
    enabled: isCompose && showAdd,
    retry: false,
  });

  // Pre-select first service + its first port when the list arrives.
  useEffect(() => {
    if (!isCompose || !services.data?.services.length) return;
    if (!serviceName) {
      const first = services.data.services[0]!;
      setServiceName(first.name);
      if (first.ports.length > 0) setPort(String(first.ports[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.data]);

  const add = useMutation({
    mutationFn: (body: {
      hostname: string;
      port: number;
      serviceName?: string;
      sslEnabled: boolean;
    }) =>
      api(`/apps/${appId}/domains`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app", appId] });
      setShowAdd(false);
      setHostname("");
      setPort("80");
      setServiceName("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/apps/${appId}/domains/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", appId] }),
  });

  const reapply = useMutation({
    mutationFn: (id: string) =>
      api(`/apps/${appId}/domains/${id}/reapply`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", appId] }),
    onError: (err: Error) => setError(err.message),
  });

  const [sslFor, setSslFor] = useState<Domain | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Domains</h2>
        <button
          onClick={() => {
            setShowAdd(!showAdd);
            setError(null);
          }}
          className="text-sm bg-slate-800 hover:bg-slate-700 rounded px-3 py-1"
        >
          {showAdd ? "Cancel" : "+ Add domain"}
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded">
        {domains.length === 0 && !showAdd && (
          <div className="text-slate-500 text-sm p-4">
            No domains bound. Add one to expose this app on a hostname.
          </div>
        )}
        {domains.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between p-3 border-b border-slate-800 last:border-b-0"
          >
            <div>
              <a
                href={`${d.sslEnabled ? "https" : "http"}://${d.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-indigo-400 hover:underline"
              >
                {d.sslEnabled ? "https" : "http"}://{d.hostname}
              </a>
              <span className="text-xs text-slate-500 ml-2">
                → {d.serviceName ? `${d.serviceName}:` : ":"}
                {d.port}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {d.sslEnabled ? (
                <span
                  className="text-xs bg-green-900/40 text-green-300 px-2 py-0.5 rounded"
                  title={
                    d.certExpiresAt
                      ? `Renews automatically · expires ${new Date(d.certExpiresAt).toLocaleDateString()}`
                      : "SSL enabled"
                  }
                >
                  SSL
                </span>
              ) : (
                <button
                  onClick={() => setSslFor(d)}
                  className="text-xs bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-700/40 text-emerald-200 rounded px-2 py-0.5"
                  title="Issue a Let's Encrypt certificate"
                >
                  Issue SSL
                </button>
              )}
              <button
                onClick={() => reapply.mutate(d.id)}
                disabled={reapply.isPending}
                className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
                title="Re-write nginx config and reload"
              >
                Reapply
              </button>
              <button
                onClick={() => {
                  if (confirm(`Remove ${d.hostname}? Nginx config will be deleted.`)) {
                    del.mutate(d.id);
                  }
                }}
                className="text-xs bg-red-900 hover:bg-red-800 rounded px-2 py-1"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {showAdd && (
          <div className="p-3 border-t border-slate-800 space-y-2">
            {isCompose && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Service (from your docker-compose.yml)
                </label>
                {services.isLoading ? (
                  <div className="text-xs text-slate-500 py-1.5">
                    Detecting services…
                  </div>
                ) : services.error ? (
                  <div>
                    <input
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value.trim())}
                      placeholder="web"
                      className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
                    />
                    <p className="text-xs text-amber-400 mt-1">
                      Couldn't auto-detect ({(services.error as Error).message}).
                      Type the service name manually.
                    </p>
                  </div>
                ) : (
                  <select
                    value={serviceName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setServiceName(next);
                      const match = services.data?.services.find(
                        (s) => s.name === next,
                      );
                      if (match && match.ports.length > 0) {
                        setPort(String(match.ports[0]));
                      }
                    }}
                    className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
                  >
                    {(services.data?.services ?? []).map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {s.image ? ` — ${s.image}` : ""}
                        {s.ports.length > 0 ? ` (:${s.ports.join(", :")})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input
                value={hostname}
                onChange={(e) => setHostname(e.target.value.trim().toLowerCase())}
                placeholder="hello.local"
                className="bg-slate-800 rounded px-2 py-1 font-mono text-sm"
              />
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="port"
                className="bg-slate-800 rounded px-2 py-1 font-mono text-sm"
              />
            </div>
            <p className="text-xs text-slate-500">
              {isCompose
                ? "Nginx will proxy to <service>:<port> inside panel_net."
                : "Hostname → container port."}{" "}
              For local testing, add{" "}
              <code className="bg-slate-800 px-1 rounded">
                127.0.0.1 {hostname || "hello.local"}
              </code>{" "}
              to your hosts file.
            </p>
            {error && <div className="text-red-400 text-sm">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setError(null);
                  add.mutate({
                    hostname,
                    port: parseInt(port, 10),
                    serviceName: isCompose ? serviceName || undefined : undefined,
                    sslEnabled: false,
                  });
                }}
                disabled={
                  add.isPending || !hostname || (isCompose && !serviceName)
                }
                className="text-sm bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1 disabled:opacity-50"
              >
                {add.isPending ? "Applying nginx config…" : "Add domain"}
              </button>
            </div>
          </div>
        )}
      </div>

      {sslFor && (
        <IssueSslModal
          appId={appId}
          domain={sslFor}
          onClose={() => setSslFor(null)}
        />
      )}
    </section>
  );
}

function IssueSslModal({
  appId,
  domain,
  onClose,
}: {
  appId: string;
  domain: Domain;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [staging, setStaging] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const issue = useMutation<
    { hostname: string; expiresAt: string; staging: boolean; logs?: string[] },
    Error & { issues?: unknown },
    { email: string; staging: boolean }
  >({
    mutationFn: (body) =>
      api(`/apps/${appId}/domains/${domain.id}/ssl/issue`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setLogs(data.logs ?? []);
      qc.invalidateQueries({ queryKey: ["app", appId] });
    },
    onError: (err) => {
      setLogs((err as unknown as { logs?: string[] }).logs ?? []);
    },
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold">Issue SSL certificate</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {domain.hostname}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="p-4 space-y-3 overflow-auto">
          {issue.data ? (
            <div className="bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2 text-sm text-emerald-300">
              Cert issued for <b className="font-mono">{issue.data.hostname}</b>.
              Expires {new Date(issue.data.expiresAt).toLocaleDateString()}.
              {issue.data.staging && " (staging — not trusted by browsers)"}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
                  Account email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Let's Encrypt sends expiration reminders here.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={staging}
                  onChange={(e) => setStaging(e.target.checked)}
                />
                Use Let's Encrypt staging environment (for testing, not trusted by browsers)
              </label>
              <p className="text-xs text-slate-500">
                The domain must resolve to this server publicly over HTTP for
                the challenge to succeed. <b className="text-slate-400">localhost / .local domains will fail.</b>
              </p>
            </>
          )}

          {issue.error && (
            <div className="bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 text-sm text-red-300">
              {issue.error.message}
            </div>
          )}

          {logs.length > 0 && (
            <details open className="bg-slate-950 border border-slate-800 rounded-lg">
              <summary className="px-3 py-2 text-xs text-slate-400 cursor-pointer">
                certbot logs ({logs.length} lines)
              </summary>
              <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                {logs.join("\n")}
              </pre>
            </details>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="text-sm text-slate-400 hover:text-white px-3 py-2"
          >
            {issue.data ? "Close" : "Cancel"}
          </button>
          {!issue.data && (
            <button
              onClick={() => issue.mutate({ email, staging })}
              disabled={issue.isPending || !email}
              className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {issue.isPending ? "Issuing…" : "Issue certificate"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function WebhookSection({
  appId,
  webhookSecret,
  branch,
}: {
  appId: string;
  webhookSecret: string | null;
  branch: string;
}) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);

  const regenerate = useMutation({
    mutationFn: () =>
      api<{ webhookSecret: string }>(`/apps/${appId}/webhook/regenerate`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", appId] }),
  });

  const webhookUrl = `${window.location.origin}/api/webhooks/${appId}`;

  async function copy(text: string, kind: "url" | "secret") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Webhook (auto-deploy on push)</h2>
      <div className="bg-slate-900 border border-slate-800 rounded p-4 space-y-3 text-sm">
        <div>
          <div className="text-slate-400 text-xs mb-1">Payload URL</div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 bg-slate-950 rounded px-2 py-1 font-mono text-xs break-all">
              {webhookUrl}
            </code>
            <button
              onClick={() => copy(webhookUrl, "url")}
              className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              {copied === "url" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <div className="text-slate-400 text-xs mb-1 flex items-center justify-between">
            <span>Secret (use as the webhook secret in GitHub / GitLab)</span>
            <button
              onClick={() => setShow((s) => !s)}
              className="text-slate-400 hover:text-white"
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 bg-slate-950 rounded px-2 py-1 font-mono text-xs break-all">
              {show
                ? webhookSecret ?? "(none)"
                : webhookSecret
                  ? "•".repeat(40)
                  : "(none)"}
            </code>
            <button
              onClick={() =>
                webhookSecret ? copy(webhookSecret, "secret") : null
              }
              disabled={!webhookSecret}
              className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 disabled:opacity-50"
            >
              {copied === "secret" ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => {
                if (confirm("Regenerate webhook secret? Existing GitHub webhook will stop working until you update it.")) {
                  regenerate.mutate();
                }
              }}
              disabled={regenerate.isPending}
              className="text-xs bg-amber-800 hover:bg-amber-700 rounded px-2 py-1 disabled:opacity-50"
            >
              {regenerate.isPending ? "…" : "Regenerate"}
            </button>
          </div>
        </div>

        <details>
          <summary className="text-slate-400 cursor-pointer hover:text-slate-200">
            How to set up on GitHub
          </summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1 text-slate-400 text-xs">
            <li>
              Go to your repo → <b>Settings → Webhooks → Add webhook</b>.
            </li>
            <li>
              <b>Payload URL:</b> paste the URL above. Panel must be publicly
              reachable — for local testing, use{" "}
              <a
                href="https://ngrok.com/"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:underline"
              >
                ngrok
              </a>{" "}
              or Cloudflare Tunnel and replace the host portion.
            </li>
            <li>
              <b>Content type:</b> <code className="text-slate-300">application/json</code>
            </li>
            <li>
              <b>Secret:</b> paste the secret above.
            </li>
            <li>
              <b>Which events?</b> "Just the push event" is fine.
            </li>
            <li>
              Push to <code className="text-slate-300">{branch}</code> — the
              panel will auto-build & deploy. Other branches are ignored.
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            GitLab also works — use the same URL, set the secret in the "Secret
            token" field, enable "Push events".
          </p>
        </details>
      </div>
    </section>
  );
}

// ============================================================================
// General — editable description + source-type badge + container name.
// ============================================================================

function GeneralSection({ app }: { app: AppDetail }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(app.description ?? "");
  const [editing, setEditing] = useState(false);

  // Keep local state in sync if the server data changes while we're not editing.
  useEffect(() => {
    if (!editing) setDescription(app.description ?? "");
  }, [app.description, editing]);

  const save = useMutation({
    mutationFn: () =>
      api(`/apps/${app.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app", app.id] });
      setEditing(false);
    },
  });

  const ports = app.runtimeConfig?.ports ?? [];

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">General</h2>
      <div className="bg-slate-900 border border-slate-800 rounded p-4 text-sm space-y-3">
        <div className="grid grid-cols-[160px_1fr] gap-y-2 gap-x-3 items-center">
          <span className="text-slate-400">Slug</span>
          <span className="font-mono">{app.slug}</span>

          <span className="text-slate-400">Project</span>
          <span className="font-mono">
            {app.project ? app.project.name : "(unscoped)"}
          </span>

          <span className="text-slate-400">Source</span>
          <span>
            {app.sourceType === "git-repo" ? (
              <span className="inline-flex items-center gap-1 text-xs bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded">
                git · {app.buildMode ?? "dockerfile"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                prebuilt image
              </span>
            )}
          </span>

          <span className="text-slate-400">Container</span>
          <span className="font-mono">panel_{app.slug}</span>

          <span className="text-slate-400">Restart policy</span>
          <span className="font-mono">
            {app.runtimeConfig?.restartPolicy ?? "unless-stopped"}
          </span>

          <span className="text-slate-400">Ports</span>
          <span className="font-mono">
            {ports.length
              ? ports.map((p) => `${p.host}→${p.container}`).join(", ")
              : "—"}
          </span>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs uppercase tracking-wider text-slate-500">
              Description
            </label>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What this app does…"
                className="w-full bg-slate-800 rounded px-2 py-1 text-sm"
              />
              {save.error && (
                <div className="text-red-400 text-xs">
                  {(save.error as Error).message}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setDescription(app.description ?? "");
                    setEditing(false);
                  }}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1 disabled:opacity-50"
                >
                  {save.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-300">
              {app.description || (
                <span className="text-slate-600">— no description —</span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Source — editable git URL / branch / build mode / paths. Saving marks the
// config as "pending" — the next Build & Deploy picks them up.
// ============================================================================

function SourceSection({ app }: { app: AppDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [repoUrl, setRepoUrl] = useState(app.repoUrl ?? "");
  const [branch, setBranch] = useState(app.branch ?? "main");
  const [buildMode, setBuildMode] = useState(app.buildMode ?? "dockerfile");
  const [dockerfilePath, setDockerfilePath] = useState(
    app.dockerfilePath ?? "Dockerfile",
  );
  const [composePath, setComposePath] = useState(
    app.composePath ?? "docker-compose.yml",
  );

  // Reset form when server data changes (we're not actively editing).
  useEffect(() => {
    if (editing) return;
    setRepoUrl(app.repoUrl ?? "");
    setBranch(app.branch ?? "main");
    setBuildMode(app.buildMode ?? "dockerfile");
    setDockerfilePath(app.dockerfilePath ?? "Dockerfile");
    setComposePath(app.composePath ?? "docker-compose.yml");
  }, [
    app.repoUrl,
    app.branch,
    app.buildMode,
    app.dockerfilePath,
    app.composePath,
    editing,
  ]);

  const save = useMutation({
    mutationFn: () =>
      api(`/apps/${app.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          git: {
            repoUrl: repoUrl || undefined,
            branch,
            buildMode,
            dockerfilePath,
            composePath,
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app", app.id] });
      setEditing(false);
    },
  });

  const dirty =
    editing &&
    ((app.repoUrl ?? "") !== repoUrl ||
      (app.branch ?? "main") !== branch ||
      (app.buildMode ?? "dockerfile") !== buildMode ||
      (app.dockerfilePath ?? "Dockerfile") !== dockerfilePath ||
      (app.composePath ?? "docker-compose.yml") !== composePath);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Source</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Edit
          </button>
        )}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded p-4 text-sm">
        {!editing ? (
          <div className="grid grid-cols-[160px_1fr] gap-y-2 gap-x-3">
            <span className="text-slate-400">Repo</span>
            <span className="font-mono text-xs break-all">
              {app.repoUrl ?? app.githubRepoFullName ?? "—"}
            </span>

            <span className="text-slate-400">Branch</span>
            <span className="font-mono">{app.branch ?? "main"}</span>

            <span className="text-slate-400">Build mode</span>
            <span className="font-mono">{app.buildMode ?? "dockerfile"}</span>

            {app.buildMode === "dockerfile" && (
              <>
                <span className="text-slate-400">Dockerfile path</span>
                <span className="font-mono">
                  {app.dockerfilePath ?? "Dockerfile"}
                </span>
              </>
            )}
            {app.buildMode === "compose" && (
              <>
                <span className="text-slate-400">Compose file</span>
                <span className="font-mono">
                  {app.composePath ?? "docker-compose.yml"}
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                Repo URL
              </label>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
              />
              {app.githubRepoFullName && (
                <p className="text-xs text-slate-500 mt-1">
                  This app is connected via GitHub App ({app.githubRepoFullName}).
                  Changing the URL here switches to PAT mode.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Branch
                </label>
                <input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Build mode
                </label>
                <select
                  value={buildMode}
                  onChange={(e) =>
                    setBuildMode(
                      e.target.value as "dockerfile" | "static" | "compose",
                    )
                  }
                  className="w-full bg-slate-800 rounded px-2 py-1 text-sm"
                >
                  <option value="dockerfile">dockerfile</option>
                  <option value="static">static</option>
                  <option value="compose">compose</option>
                </select>
              </div>
            </div>

            {buildMode === "dockerfile" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Dockerfile path
                </label>
                <input
                  value={dockerfilePath}
                  onChange={(e) => setDockerfilePath(e.target.value)}
                  className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
                />
              </div>
            )}
            {buildMode === "compose" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                  Compose file
                </label>
                <input
                  value={composePath}
                  onChange={(e) => setComposePath(e.target.value)}
                  className="w-full bg-slate-800 rounded px-2 py-1 font-mono text-sm"
                />
              </div>
            )}

            {save.error && (
              <div className="text-red-400 text-xs">
                {(save.error as Error).message}
              </div>
            )}

            {dirty && (
              <div className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900/50 rounded px-2 py-1.5">
                Changes pending — click <b>Save</b> then <b>Build & Deploy</b>{" "}
                in the top bar to apply.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || !dirty}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1 disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
