import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  GitBranch,
  Package,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  FolderKanban,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";
import { CreateAppModal } from "./apps";

interface AppRow {
  id: string;
  slug: string;
  description: string | null;
  imageRef: string | null;
  sourceType: string;
  buildMode: string | null;
  repoUrl: string | null;
  branch: string | null;
  githubRepoFullName: string | null;
  createdAt: string;
  deployments: Array<{
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
  }>;
}

interface ProjectDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  apps: AppRow[];
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

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [delError, setDelError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectDetail>(`/projects/${id}`),
    refetchInterval: 6000,
    enabled: !!id,
  });

  const del = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav("/projects");
    },
    onError: (err: Error) => setDelError(err.message),
  });

  if (isLoading) {
    return (
      <Layout title="Loading…">
        <div className="text-slate-400">Loading project…</div>
      </Layout>
    );
  }
  if (error || !data) {
    return (
      <Layout title="Not found">
        <div className="text-red-400">
          {error ? (error as Error).message : "Project not found"}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title={data.name}
      subtitle={data.description ?? `${data.apps.length} apps`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/projects"
            className="text-sm text-slate-400 hover:text-white px-3 py-2"
          >
            ← Projects
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3.5 py-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New app
          </button>
          {data.slug !== "default" && (
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete project "${data.name}"? Only allowed if no apps belong to it.`,
                  )
                ) {
                  del.mutate();
                }
              }}
              className="inline-flex items-center gap-1.5 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-lg px-3.5 py-2 text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      }
    >
      {delError && (
        <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 mb-4">
          {delError}
        </div>
      )}

      {data.apps.length === 0 ? (
        <div className="card p-12 text-center">
          <FolderKanban className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <div className="text-slate-300 mb-1">No apps in this project</div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            + Add the first app →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.apps.map((a) => {
            const Icon = sourceIcon(a);
            const last = a.deployments[0];
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
                  {a.imageRef ?? a.githubRepoFullName ?? a.repoUrl ?? "—"}
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
          defaultProjectId={data.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["project", id] });
            qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      )}
    </Layout>
  );
}
