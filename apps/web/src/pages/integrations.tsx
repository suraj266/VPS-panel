import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Github,
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

interface InstallationSummary {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
  suspendedAt: string | null;
}

interface GithubAppRow {
  id: string;
  githubAppId: number;
  slug: string;
  name: string;
  htmlUrl: string;
  installUrl: string;
  createdAt: string;
  installations: InstallationSummary[];
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const justRegistered = params.get("registered");

  // After a fresh manifest registration, refetch and clean the URL.
  useEffect(() => {
    if (justRegistered) {
      qc.invalidateQueries({ queryKey: ["github-apps"] });
      const next = new URLSearchParams(params);
      next.delete("registered");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justRegistered]);

  const apps = useQuery({
    queryKey: ["github-apps"],
    queryFn: () => api<GithubAppRow[]>("/github-apps"),
    refetchInterval: 30_000,
  });

  return (
    <Layout
      title="Integrations"
      subtitle="Connect Git providers so the panel can pull repos and auto-deploy on push."
    >
      <section className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1 flex items-center gap-2">
              <Github className="w-4 h-4 text-slate-400" />
              GitHub
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl">
              Register a GitHub App to deploy from any repo your installations
              can access — personal account, orgs, or both. Tokens are minted
              just-in-time, never stored. The app's single webhook URL handles
              all your repos.
            </p>
          </div>
          <RegisterGitHubAppButton />
        </div>

        {apps.isLoading && (
          <div className="text-slate-400 text-sm">Loading…</div>
        )}
        {apps.error && (
          <div className="text-red-400 text-sm">
            {(apps.error as Error).message}
          </div>
        )}
        {apps.data && apps.data.length === 0 && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 text-center">
            <Github className="w-8 h-8 mx-auto text-slate-600 mb-2" />
            <div className="text-slate-300 mb-1">No GitHub App connected</div>
            <div className="text-xs text-slate-500 max-w-sm mx-auto">
              Click "Register GitHub App" to create one. You'll be redirected to
              GitHub to name and install it.
            </div>
          </div>
        )}

        {apps.data && apps.data.length > 0 && (
          <div className="space-y-4">
            {apps.data.map((a) => (
              <GithubAppCard key={a.id} app={a} />
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}

function RegisterGitHubAppButton() {
  const formRef = useRef<HTMLFormElement>(null);

  const start = useMutation({
    mutationFn: async () => {
      const origin = window.location.origin;
      const state = crypto.randomUUID();
      const res = await api<{ manifest: Record<string, unknown> }>(
        "/github-apps/manifest",
        {
          method: "POST",
          body: JSON.stringify({ origin, state }),
        },
      );
      return { manifest: res.manifest, state };
    },
    onSuccess: ({ manifest, state }) => {
      // POST the manifest to GitHub via a form submission. This is the only
      // way the manifest flow works — query-string is size-limited.
      if (!formRef.current) return;
      const f = formRef.current;
      f.action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
      const input = f.querySelector("input[name=manifest]") as HTMLInputElement;
      input.value = JSON.stringify(manifest);
      f.submit();
    },
  });

  return (
    <>
      <form ref={formRef} method="post" target="_top">
        <input type="hidden" name="manifest" value="" />
      </form>
      <button
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 shrink-0"
      >
        {start.isPending ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Plus className="w-4 h-4" />
        )}
        Register GitHub App
      </button>
    </>
  );
}

function GithubAppCard({ app }: { app: GithubAppRow }) {
  const qc = useQueryClient();

  const refresh = useMutation({
    mutationFn: () =>
      api(`/github-apps/${app.id}/refresh-installations`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-apps"] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api(`/github-apps/${app.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-apps"] }),
  });

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
            <Github className="w-4 h-4 text-slate-300" />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{app.name}</div>
            <a
              href={app.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-400 hover:underline inline-flex items-center gap-1"
            >
              {app.slug} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            title="Refresh installations from GitHub"
            className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-2 py-1 text-xs disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <a
            href={app.installUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-700/40 text-emerald-200 rounded-md px-2 py-1 text-xs"
          >
            <Plus className="w-3 h-3" /> Install on account
          </a>
          <button
            onClick={() => {
              if (
                confirm(
                  `Disconnect "${app.name}"? Apps using its installations will lose deploy access.`,
                )
              ) {
                disconnect.mutate();
              }
            }}
            className="inline-flex items-center gap-1 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-md px-2 py-1 text-xs"
          >
            <Trash2 className="w-3 h-3" /> Disconnect
          </button>
        </div>
      </div>

      <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
        Installed accounts ({app.installations.length})
      </div>
      {app.installations.length === 0 ? (
        <div className="text-xs text-slate-500 bg-slate-900/50 rounded-lg p-3 text-center">
          Not installed on any account yet.{" "}
          <a
            href={app.installUrl}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            Install on an account →
          </a>{" "}
          then click <strong>Refresh</strong>.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {app.installations.map((inst) => (
            <li
              key={inst.id}
              className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                {inst.accountAvatarUrl ? (
                  <img
                    src={inst.accountAvatarUrl}
                    alt={inst.accountLogin}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-slate-800" />
                )}
                <div className="min-w-0">
                  <div className="font-mono truncate">
                    {inst.accountLogin}
                    <span className="text-xs text-slate-500 ml-1.5">
                      ({inst.accountType.toLowerCase()})
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {inst.repositorySelection === "all"
                      ? "all repositories"
                      : "selected repositories only"}
                    {inst.suspendedAt && (
                      <span className="text-amber-400 ml-2">· suspended</span>
                    )}
                  </div>
                </div>
              </div>
              {!inst.suspendedAt && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  active
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
