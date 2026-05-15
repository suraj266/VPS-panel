import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ScrollText,
  TerminalSquare,
  FileCode,
  Play,
  Square,
  RotateCw,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";
import { RunContainerModal } from "../components/run-container-modal";
import { LogsModal } from "../components/logs-modal";
import { TerminalModal } from "../components/terminal-modal";
import { FileEditorModal } from "../components/file-editor-modal";

interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ privatePort: number; publicPort?: number; type: string }>;
  labels?: Record<string, string>;
}

type Action = "start" | "stop" | "restart" | "remove";

function IconBtn({
  Icon,
  label,
  onClick,
  variant = "neutral",
  title,
}: {
  Icon: typeof Play;
  label: string;
  onClick: () => void;
  variant?: "neutral" | "primary" | "warn" | "danger";
  title?: string;
}) {
  const cls = {
    neutral: "bg-slate-800 hover:bg-slate-700 text-slate-200",
    primary: "bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 border border-emerald-700/40",
    warn: "bg-amber-700/30 hover:bg-amber-700/50 text-amber-200 border border-amber-700/40",
    danger: "bg-red-800/30 hover:bg-red-800/50 text-red-200 border border-red-800/40",
  }[variant];
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

export function ContainersPage() {
  const qc = useQueryClient();
  const [showRun, setShowRun] = useState(false);
  const [logsFor, setLogsFor] = useState<ContainerSummary | null>(null);
  const [terminalFor, setTerminalFor] = useState<ContainerSummary | null>(null);
  const [filesFor, setFilesFor] = useState<ContainerSummary | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["containers"],
    queryFn: () => api<ContainerSummary[]>("/containers"),
    refetchInterval: 5000,
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) =>
      api(`/containers/${id}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["containers"] }),
  });

  const total = data?.length ?? 0;
  const running = data?.filter((c) => c.state === "running").length ?? 0;

  return (
    <Layout
      title="Containers"
      subtitle={`${running} running · ${total} total`}
      actions={
        <button
          onClick={() => setShowRun(true)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3.5 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Run container
        </button>
      }
    >
      {isLoading && <div className="text-slate-400">Loading…</div>}
      {error && <div className="text-red-400">{(error as Error).message}</div>}

      {data && data.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-slate-400 mb-2">No containers</div>
          <button
            onClick={() => setShowRun(true)}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Run your first container →
          </button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-900/40">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Image</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium">Ports</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const panelManaged = c.labels?.["panel.managed"] === "true";
                return (
                  <tr
                    key={c.id}
                    className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-5 py-3 font-mono">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            c.state === "running"
                              ? "w-2 h-2 rounded-full bg-emerald-400 shrink-0"
                              : "w-2 h-2 rounded-full bg-slate-600 shrink-0"
                          }
                        />
                        <span>{c.name}</span>
                        {panelManaged && (
                          <span
                            className="text-[10px] uppercase tracking-wider bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded"
                            title="Managed by the panel"
                          >
                            panel
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-400 truncate max-w-xs">
                      {c.image}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col">
                        <span
                          className={
                            c.state === "running"
                              ? "text-emerald-400 text-xs font-medium"
                              : "text-slate-400 text-xs"
                          }
                        >
                          {c.state}
                        </span>
                        <span className="text-xs text-slate-500">
                          {c.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs font-mono">
                      {c.ports
                        .filter((p) => p.publicPort)
                        .map((p) => `${p.publicPort}→${p.privatePort}`)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        <IconBtn
                          Icon={ScrollText}
                          label="Logs"
                          onClick={() => setLogsFor(c)}
                        />
                        {c.state === "running" && (
                          <IconBtn
                            Icon={TerminalSquare}
                            label="Shell"
                            onClick={() => setTerminalFor(c)}
                          />
                        )}
                        {c.state === "running" && (
                          <IconBtn
                            Icon={FileCode}
                            label="Files"
                            onClick={() => setFilesFor(c)}
                            title="Edit files inside the container"
                          />
                        )}
                        {c.state !== "running" && (
                          <IconBtn
                            Icon={Play}
                            label="Start"
                            variant="primary"
                            onClick={() =>
                              action.mutate({ id: c.id, action: "start" })
                            }
                          />
                        )}
                        {c.state === "running" && (
                          <>
                            <IconBtn
                              Icon={Square}
                              label="Stop"
                              variant="warn"
                              onClick={() =>
                                action.mutate({ id: c.id, action: "stop" })
                              }
                            />
                            <IconBtn
                              Icon={RotateCw}
                              label="Restart"
                              onClick={() =>
                                action.mutate({ id: c.id, action: "restart" })
                              }
                            />
                          </>
                        )}
                        <IconBtn
                          Icon={Trash2}
                          label="Remove"
                          variant="danger"
                          onClick={() => {
                            if (
                              confirm(
                                `Remove ${c.name}? This cannot be undone.`,
                              )
                            ) {
                              action.mutate({ id: c.id, action: "remove" });
                            }
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showRun && <RunContainerModal onClose={() => setShowRun(false)} />}
      {logsFor && (
        <LogsModal
          containerId={logsFor.id}
          containerName={logsFor.name}
          onClose={() => setLogsFor(null)}
        />
      )}
      {terminalFor && (
        <TerminalModal
          containerId={terminalFor.id}
          containerName={terminalFor.name}
          onClose={() => setTerminalFor(null)}
        />
      )}
      {filesFor && (
        <FileEditorModal
          containerId={filesFor.id}
          containerName={filesFor.name}
          onClose={() => setFilesFor(null)}
        />
      )}
    </Layout>
  );
}
