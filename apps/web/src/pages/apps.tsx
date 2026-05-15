import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  GitBranch,
  Package,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

interface PortMapping {
  host: number;
  container: number;
  proto?: "tcp" | "udp";
}

interface AppRow {
  id: string;
  slug: string;
  description: string | null;
  imageRef: string | null;
  sourceType: string;
  buildMode: string | null;
  repoUrl: string | null;
  branch: string | null;
  createdAt: string;
  deployments: Array<{ id: string; status: string; startedAt: string }>;
}

function sourceIcon(app: AppRow) {
  if (app.sourceType === "git-repo") {
    if (app.buildMode === "compose") return Layers;
    return GitBranch;
  }
  return Package;
}

function statusBadge(status: string | undefined) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Clock className="w-3 h-3" /> never deployed
      </span>
    );
  }
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> succeeded
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <XCircle className="w-3 h-3" /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-400">
      <Clock className="w-3 h-3" /> {status}
    </span>
  );
}

export function AppsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<AppRow[]>("/apps"),
    refetchInterval: 5000,
  });

  return (
    <Layout
      title="Apps"
      subtitle="Containerized applications managed by the panel"
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3.5 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New app
        </button>
      }
    >
      {isLoading && <div className="text-slate-400">Loading…</div>}
      {error && <div className="text-red-400">{(error as Error).message}</div>}

      {data && data.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-slate-400 mb-2">No apps yet</div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Create your first app →
          </button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((a) => {
            const last = a.deployments[0];
            const Icon = sourceIcon(a);
            return (
              <Link
                key={a.id}
                to={`/apps/${a.id}`}
                className="card p-5 hover:border-indigo-500/40 hover:bg-slate-900 transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-indigo-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono font-semibold truncate">
                        {a.slug}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {a.sourceType === "git-repo"
                          ? `${a.buildMode ?? "git"} · ${a.branch ?? "main"}`
                          : "prebuilt image"}
                      </div>
                    </div>
                  </div>
                  {statusBadge(last?.status)}
                </div>
                <div className="text-xs text-slate-400 font-mono truncate mb-2">
                  {a.imageRef ?? a.repoUrl ?? "—"}
                </div>
                {a.description && (
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {a.description}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateAppModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["apps"] });
          }}
        />
      )}
    </Layout>
  );
}

type SourceType = "prebuilt-image" | "git-repo";
type BuildMode = "dockerfile" | "static" | "compose";
type GitSourceMode = "github-app" | "url";

interface GhInstallationOption {
  id: string; // panel installation id
  installationId: number;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  appName: string;
}

interface GhRepo {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

interface GhBranch {
  name: string;
  isDefault: boolean;
}

interface GhAppRow {
  id: string;
  name: string;
  installations: Array<{
    id: string;
    installationId: number;
    accountLogin: string;
    accountType: string;
    accountAvatarUrl: string | null;
    suspendedAt: string | null;
  }>;
}

export function CreateAppModal({
  onClose,
  onCreated,
  defaultProjectId,
}: {
  onClose: () => void;
  onCreated: () => void;
  defaultProjectId?: string;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("prebuilt-image");
  const [buildMode, setBuildMode] = useState<BuildMode>("dockerfile");
  const [gitSourceMode, setGitSourceMode] =
    useState<GitSourceMode>("github-app");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  // Fetch projects list for the picker. We only need id+name+slug here.
  const projectsList = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      api<Array<{ id: string; slug: string; name: string }>>("/projects"),
  });

  // Auto-select first project once list arrives if none chosen yet.
  useEffect(() => {
    if (!projectId && projectsList.data && projectsList.data.length > 0) {
      const def =
        projectsList.data.find((p) => p.slug === "default") ??
        projectsList.data[0]!;
      setProjectId(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsList.data]);
  const [portsText, setPortsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // image source
  const [imageRef, setImageRef] = useState("");

  // git source (shared)
  const [branch, setBranch] = useState("main");
  const [dockerfilePath, setDockerfilePath] = useState("Dockerfile");
  const [publishDir, setPublishDir] = useState(".");
  const [composePath, setComposePath] = useState("docker-compose.yml");

  // git URL mode (legacy / non-GitHub)
  const [repoUrl, setRepoUrl] = useState("");
  const [gitToken, setGitToken] = useState("");

  // GitHub App mode
  const [installationId, setInstallationId] = useState<string>("");
  const [repoFullName, setRepoFullName] = useState<string>("");
  const [repoId, setRepoId] = useState<number | null>(null);

  // Fetch connected GitHub Apps + installations (flatten across all apps).
  const ghApps = useQuery({
    queryKey: ["github-apps"],
    queryFn: () => api<GhAppRow[]>("/github-apps"),
    enabled: sourceType === "git-repo" && gitSourceMode === "github-app",
  });

  const installationOptions: GhInstallationOption[] = (ghApps.data ?? [])
    .flatMap((a) =>
      a.installations
        .filter((i) => !i.suspendedAt)
        .map((i) => ({ ...i, appName: a.name })),
    )
    .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin));

  // Auto-select first installation when list arrives.
  useEffect(() => {
    if (installationOptions.length > 0 && !installationId) {
      setInstallationId(installationOptions[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationOptions.length]);

  const repos = useQuery({
    queryKey: ["gh-installation-repos", installationId],
    queryFn: () =>
      api<{ repos: GhRepo[] }>(`/github-installations/${installationId}/repos`),
    enabled:
      sourceType === "git-repo" &&
      gitSourceMode === "github-app" &&
      !!installationId,
  });

  // When repo list arrives or installation changes, default to first repo.
  useEffect(() => {
    if (
      repos.data?.repos.length &&
      !repos.data.repos.find((r) => r.fullName === repoFullName)
    ) {
      const first = repos.data.repos[0]!;
      setRepoFullName(first.fullName);
      setRepoId(first.id);
      setBranch(first.defaultBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos.data, installationId]);

  const branches = useQuery({
    queryKey: ["gh-branches", installationId, repoFullName],
    queryFn: () => {
      const [owner, repo] = repoFullName.split("/");
      return api<{ branches: GhBranch[] }>(
        `/github-installations/${installationId}/repos/${owner}/${repo}/branches`,
      );
    },
    enabled:
      sourceType === "git-repo" &&
      gitSourceMode === "github-app" &&
      !!installationId &&
      !!repoFullName,
  });

  const create = useMutation({
    mutationFn: (body: object) =>
      api("/apps", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: onCreated,
    onError: (err: Error) => setError(err.message),
  });

  function parsePorts(): PortMapping[] {
    if (!portsText.trim()) return [];
    return portsText
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((pair) => {
        const [host, container] = pair.split(":").map((n) => parseInt(n, 10));
        if (!host || !container) throw new Error(`bad port: ${pair}`);
        return { host, container };
      });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const ports = parsePorts();
      const runtimeConfig = { ports, restartPolicy: "unless-stopped" };
      if (!projectId) {
        setError("Pick a project.");
        return;
      }
      if (sourceType === "prebuilt-image") {
        create.mutate({
          sourceType: "prebuilt-image",
          slug,
          projectId,
          imageRef,
          description: description || undefined,
          runtimeConfig,
        });
      } else {
        const gitBase = {
          branch,
          buildMode,
          dockerfilePath,
          publishDir,
          composePath,
        };
        const git =
          gitSourceMode === "github-app"
            ? {
                ...gitBase,
                githubInstallationId: installationId,
                githubRepoFullName: repoFullName,
                githubRepoId: repoId ?? undefined,
              }
            : {
                ...gitBase,
                repoUrl,
                gitToken: gitToken || undefined,
              };
        create.mutate({
          sourceType: "git-repo",
          slug,
          projectId,
          description: description || undefined,
          runtimeConfig,
          git,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid input");
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-10 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-lg space-y-3 max-h-[90vh] overflow-auto"
      >
        <h2 className="text-lg font-semibold">New app</h2>

        <div>
          <label className="block text-sm mb-1 text-slate-400">Project</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            className="w-full bg-slate-800 rounded px-3 py-2 text-sm"
          >
            {projectsList.isLoading && <option value="">Loading…</option>}
            {projectsList.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 p-1 bg-slate-950 rounded">
          <button
            type="button"
            onClick={() => setSourceType("prebuilt-image")}
            className={`flex-1 rounded py-1.5 text-sm ${
              sourceType === "prebuilt-image"
                ? "bg-slate-800 text-white"
                : "text-slate-400"
            }`}
          >
            Pre-built image
          </button>
          <button
            type="button"
            onClick={() => setSourceType("git-repo")}
            className={`flex-1 rounded py-1.5 text-sm ${
              sourceType === "git-repo"
                ? "bg-slate-800 text-white"
                : "text-slate-400"
            }`}
          >
            Git repo
          </button>
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Slug (a-z, 0-9, dashes)
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="my-app"
            className="w-full bg-slate-800 rounded px-3 py-2 font-mono"
          />
        </div>

        {sourceType === "prebuilt-image" && (
          <div>
            <label className="block text-sm mb-1 text-slate-400">Image</label>
            <input
              value={imageRef}
              onChange={(e) => setImageRef(e.target.value)}
              required
              placeholder="nginx:latest"
              className="w-full bg-slate-800 rounded px-3 py-2 font-mono"
            />
          </div>
        )}

        {sourceType === "git-repo" && (
          <>
            <div>
              <label className="block text-sm mb-1 text-slate-400">
                Repository source
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded">
                <button
                  type="button"
                  onClick={() => setGitSourceMode("github-app")}
                  className={`rounded py-1.5 text-sm ${
                    gitSourceMode === "github-app"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400"
                  }`}
                  title="Use a connected GitHub App"
                >
                  GitHub
                </button>
                <button
                  type="button"
                  onClick={() => setGitSourceMode("url")}
                  className={`rounded py-1.5 text-sm ${
                    gitSourceMode === "url"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400"
                  }`}
                  title="Paste a Git URL + optional token (non-GitHub or PAT mode)"
                >
                  Git URL (advanced)
                </button>
              </div>
            </div>

            {gitSourceMode === "github-app" && (
              <>
                {ghApps.isLoading ? (
                  <div className="text-slate-400 text-sm">
                    Loading GitHub Apps…
                  </div>
                ) : installationOptions.length === 0 ? (
                  <div className="text-sm bg-amber-950/40 border border-amber-900/50 text-amber-200 rounded px-3 py-2">
                    No GitHub App installed.{" "}
                    <Link
                      to="/integrations"
                      className="underline hover:text-amber-100"
                    >
                      Connect one →
                    </Link>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm mb-1 text-slate-400">
                        Account
                      </label>
                      <select
                        value={installationId}
                        onChange={(e) => {
                          setInstallationId(e.target.value);
                          setRepoFullName("");
                          setRepoId(null);
                        }}
                        className="w-full bg-slate-800 rounded px-3 py-2 text-sm"
                      >
                        {installationOptions.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.accountLogin} ({i.accountType.toLowerCase()}) —{" "}
                            {i.appName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm mb-1 text-slate-400">
                        Repository
                      </label>
                      {repos.isLoading ? (
                        <div className="text-xs text-slate-500 py-2">
                          Loading repos…
                        </div>
                      ) : repos.error ? (
                        <div className="text-xs text-red-400 py-2">
                          {(repos.error as Error).message}
                        </div>
                      ) : (
                        <select
                          value={repoFullName}
                          onChange={(e) => {
                            const r = repos.data?.repos.find(
                              (x) => x.fullName === e.target.value,
                            );
                            setRepoFullName(e.target.value);
                            setRepoId(r?.id ?? null);
                            if (r) setBranch(r.defaultBranch);
                          }}
                          className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                          required
                        >
                          {(repos.data?.repos ?? []).map((r) => (
                            <option key={r.id} value={r.fullName}>
                              {r.fullName}
                              {r.private ? " (private)" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {gitSourceMode === "url" && (
              <div>
                <label className="block text-sm mb-1 text-slate-400">
                  Repository URL
                </label>
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required
                  placeholder="https://github.com/user/repo.git"
                  className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                />
              </div>
            )}
            <div>
              <label className="block text-sm mb-1 text-slate-400">
                Build mode
              </label>
              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-950 rounded">
                <button
                  type="button"
                  onClick={() => setBuildMode("dockerfile")}
                  className={`rounded py-1.5 text-sm ${
                    buildMode === "dockerfile"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400"
                  }`}
                  title="Use a Dockerfile in the repo"
                >
                  Dockerfile
                </button>
                <button
                  type="button"
                  onClick={() => setBuildMode("static")}
                  className={`rounded py-1.5 text-sm ${
                    buildMode === "static"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400"
                  }`}
                  title="Plain HTML/CSS/JS — panel auto-generates an nginx Dockerfile"
                >
                  Static
                </button>
                <button
                  type="button"
                  onClick={() => setBuildMode("compose")}
                  className={`rounded py-1.5 text-sm ${
                    buildMode === "compose"
                      ? "bg-slate-800 text-white"
                      : "text-slate-400"
                  }`}
                  title="Multi-container app via docker-compose.yml"
                >
                  Compose
                </button>
              </div>
              {buildMode === "static" && (
                <p className="text-xs text-slate-500 mt-1">
                  Panel auto-generates a Dockerfile that serves your files with
                  nginx. Use container port <code>80</code> below.
                </p>
              )}
              {buildMode === "compose" && (
                <p className="text-xs text-slate-500 mt-1">
                  Panel runs <code>docker compose up</code> with project name{" "}
                  <code>panel_&lt;slug&gt;</code>. Services are auto-attached to{" "}
                  <code>panel_net</code> with their service name as the alias.
                  Add domains per-service in the app detail page. Host port
                  mappings come from your compose file.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm mb-1 text-slate-400">
                  Branch
                </label>
                {gitSourceMode === "github-app" &&
                (branches.data?.branches.length ?? 0) > 0 ? (
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    required
                    className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                  >
                    {branches.data!.branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    required
                    placeholder="main"
                    className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm mb-1 text-slate-400">
                  {buildMode === "dockerfile"
                    ? "Dockerfile path"
                    : buildMode === "static"
                      ? "Publish dir"
                      : "Compose file"}
                </label>
                {buildMode === "dockerfile" && (
                  <input
                    value={dockerfilePath}
                    onChange={(e) => setDockerfilePath(e.target.value)}
                    required
                    placeholder="Dockerfile"
                    className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                  />
                )}
                {buildMode === "static" && (
                  <input
                    value={publishDir}
                    onChange={(e) => setPublishDir(e.target.value)}
                    required
                    placeholder="."
                    title="Folder inside repo to serve (e.g. ., dist, build, public)"
                    className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                  />
                )}
                {buildMode === "compose" && (
                  <input
                    value={composePath}
                    onChange={(e) => setComposePath(e.target.value)}
                    required
                    placeholder="docker-compose.yml"
                    className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                  />
                )}
              </div>
            </div>
            {gitSourceMode === "url" && (
              <div>
                <label className="block text-sm mb-1 text-slate-400">
                  Personal Access Token (optional, for private repos)
                </label>
                <input
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                  type="password"
                  placeholder="ghp_..."
                  className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Stored encrypted (AES-256-GCM). Leave empty for public repos.
                </p>
              </div>
            )}
          </>
        )}

        {!(sourceType === "git-repo" && buildMode === "compose") && (
          <div>
            <label className="block text-sm mb-1 text-slate-400">
              Ports (host:container, comma-separated)
            </label>
            <input
              value={portsText}
              onChange={(e) => setPortsText(e.target.value)}
              placeholder="8080:80"
              className="w-full bg-slate-800 rounded px-3 py-2 font-mono text-sm"
            />
          </div>
        )}

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Description (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-800 rounded px-3 py-2"
          />
        </div>

        {error && <div className="text-red-400 text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
