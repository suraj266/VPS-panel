import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

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

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["app", id],
    queryFn: () => api<AppDetail>(`/apps/${id}`),
    refetchInterval: 4000,
  });

  const envQuery = useQuery({
    queryKey: ["app-env", id],
    queryFn: () => api<EnvVar[]>(`/apps/${id}/env`),
  });

  const [envRows, setEnvRows] = useState<EnvRow[]>([]);

  const serverRows = useMemo<EnvRow[]>(
    () =>
      (envQuery.data ?? []).map((v) => ({
        key: v.key,
        value: v.value ?? "",
        isSecret: v.isSecret,
      })),
    [envQuery.data],
  );

  useEffect(() => {
    setEnvRows(serverRows);
  }, [serverRows]);

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

  const deploy = useMutation({
    mutationFn: () => api(`/apps/${id}/deploy`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", id] }),
  });

  const stop = useMutation({
    mutationFn: () => api(`/apps/${id}/stop`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app", id] }),
  });

  const saveEnv = useMutation({
    mutationFn: () =>
      api(`/apps/${id}/env`, {
        method: "PUT",
        body: JSON.stringify({ vars: envRows }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-env", id] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/apps/${id}`, { method: "DELETE" }),
    onSuccess: () => nav("/apps"),
  });

  const redeploy = useMutation({
    mutationFn: (deploymentId: string) =>
      api(`/apps/${id}/deployments/${deploymentId}/redeploy`, {
        method: "POST",
      }),
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

  const ports = data.runtimeConfig?.ports ?? [];
  const lastDeploy = data.deployments[0];

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
          <button
            onClick={() => {
              if (confirm(`Delete app "${data.slug}" and its container?`)) {
                remove.mutate();
              }
            }}
            className="bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-lg px-3.5 py-2 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {deploy.error && (
          <div className="bg-red-900/50 border border-red-800 rounded p-3 text-sm text-red-200">
            Deploy failed: {(deploy.error as Error).message}
          </div>
        )}

        <GeneralSection app={data} />

        {data.sourceType === "git-repo" && <SourceSection app={data} />}

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Environment variables</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEnvRows([
                    ...envRows,
                    { key: "", value: "", isSecret: false },
                  ]);
                                  }}
                className="text-sm bg-slate-800 hover:bg-slate-700 rounded px-3 py-1"
              >
                + Add
              </button>
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
          <div className="bg-slate-900 border border-slate-800 rounded">
            {envRows.length === 0 && (
              <div className="text-slate-500 text-sm p-4">No env vars set.</div>
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
                    next[i] = { ...next[i]!, key: e.target.value.toUpperCase() };
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
                  onClick={() => {
                    setEnvRows(envRows.filter((_, j) => j !== i));
                                      }}
                  className="text-slate-500 hover:text-red-400 px-2"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {envDirty && (
            <div className="text-xs text-amber-400 mt-1">
              Unsaved changes. Click Save, then Deploy to apply.
            </div>
          )}
        </section>

        <DomainsSection
          appId={data.id}
          domains={data.domains}
          isCompose={
            data.sourceType === "git-repo" &&
            (data.buildMode ?? null) === "compose"
          }
        />

        {data.sourceType === "git-repo" && (
          <WebhookSection
            appId={data.id}
            webhookSecret={data.webhookSecret ?? null}
            branch={data.branch ?? "main"}
          />
        )}

        <section>
          <h2 className="text-lg font-semibold mb-2">Deployment history</h2>
          <div className="bg-slate-900 border border-slate-800 rounded">
            {data.deployments.length === 0 && (
              <div className="text-slate-500 text-sm p-4">
                No deployments yet.
              </div>
            )}
            {data.deployments.map((d, idx) => {
              const isLatest = idx === 0;
              const isCompose = data.buildMode === "compose";
              const canRedeploy =
                d.status === "succeeded" &&
                d.imageTag &&
                d.imageTag !== "(pending)" &&
                !isCompose;
              return (
                <details
                  key={d.id}
                  className="border-b border-slate-800 last:border-b-0"
                >
                  <summary className="p-3 cursor-pointer flex items-center justify-between gap-3">
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
                        <button
                          onClick={(e) => {
                            e.preventDefault();
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
                    </span>
                  </summary>
                  {d.log && (
                    <pre className="text-xs bg-slate-950 p-3 overflow-x-auto whitespace-pre-wrap text-slate-300">
                      {d.log}
                    </pre>
                  )}
                </details>
              );
            })}
          </div>
        </section>

        {lastDeploy?.status === "succeeded" && ports[0] && (
          <div className="text-sm text-slate-400">
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
      </div>
    </Layout>
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
