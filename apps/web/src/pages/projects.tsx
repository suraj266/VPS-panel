import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  FolderKanban,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count: { apps: number };
  apps: Array<{
    id: string;
    slug: string;
    sourceType: string;
    buildMode: string | null;
    deployments: Array<{ status: string }>;
  }>;
}

export function ProjectsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectRow[]>("/projects"),
    refetchInterval: 8000,
  });

  return (
    <Layout
      title="Projects"
      subtitle="Group related apps together — a project for each service or product"
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3.5 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New project
        </button>
      }
    >
      {isLoading && <div className="text-slate-400">Loading…</div>}
      {error && <div className="text-red-400">{(error as Error).message}</div>}

      {data && data.length === 0 && (
        <div className="card p-12 text-center">
          <FolderKanban className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <div className="text-slate-300 mb-1">No projects yet</div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Create your first project →
          </button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((p) => {
            const counts = p.apps.reduce(
              (acc, a) => {
                const s = a.deployments[0]?.status;
                if (s === "succeeded") acc.up += 1;
                else if (s === "failed") acc.failed += 1;
                else if (s) acc.other += 1;
                return acc;
              },
              { up: 0, failed: 0, other: 0 },
            );
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="card p-5 hover:border-indigo-500/40 hover:bg-slate-900 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                      <FolderKanban className="w-4 h-4 text-indigo-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        {p.slug}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">
                    {p._count.apps} {p._count.apps === 1 ? "app" : "apps"}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">
                    {p.description}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs">
                  {counts.up > 0 && (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> {counts.up}
                    </span>
                  )}
                  {counts.failed > 0 && (
                    <span className="inline-flex items-center gap-1 text-red-400">
                      <XCircle className="w-3 h-3" /> {counts.failed}
                    </span>
                  )}
                  {counts.other > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Clock className="w-3 h-3" /> {counts.other}
                    </span>
                  )}
                  {p._count.apps === 0 && (
                    <span className="text-slate-600">no apps yet</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      )}
    </Layout>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: object) =>
      api("/projects", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: onCreated,
    onError: (err: Error) => setError(err.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      slug,
      name,
      description: description || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-10 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-md space-y-3"
      >
        <h2 className="text-lg font-semibold">New project</h2>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // Auto-derive slug if user hasn't customized it
              if (!slug || slug === slugify(name)) {
                setSlug(slugify(e.target.value));
              }
            }}
            required
            placeholder="My Shop"
            className="w-full bg-slate-800 rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Slug (a-z, 0-9, dashes)
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="myshop"
            pattern="[a-z0-9][a-z0-9-]*"
            className="w-full bg-slate-800 rounded px-3 py-2 font-mono"
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Description (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e-commerce backend + frontend"
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
            className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
