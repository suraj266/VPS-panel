import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

interface AuditEntry {
  id: string;
  actorId: string | null;
  actor: { id: string; email: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  diff: unknown;
  ip: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

function actionColor(action: string): string {
  if (action.startsWith("auth.login.failed")) return "text-red-400";
  if (action.includes("delete")) return "text-red-400";
  if (action.includes("rollback")) return "text-purple-400";
  if (action.includes("deploy") || action.includes("create"))
    return "text-emerald-400";
  if (action.includes("stop") || action.includes("logout"))
    return "text-amber-400";
  if (action.startsWith("auth.")) return "text-blue-400";
  return "text-slate-300";
}

export function AuditPage() {
  const [actionFilter, setActionFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("");

  const query = useInfiniteQuery<AuditPage>({
    queryKey: ["audit", actionFilter, targetTypeFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("cursor", String(pageParam));
      if (actionFilter) params.set("action", actionFilter);
      if (targetTypeFilter) params.set("targetType", targetTypeFilter);
      return api<AuditPage>(`/audit?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Layout
      title="Audit log"
      subtitle="Every write action against the panel"
      actions={
        <div className="flex gap-2">
          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            className="bg-slate-800 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">all targets</option>
            <option value="app">app</option>
            <option value="container">container</option>
            <option value="domain">domain</option>
            <option value="env">env var</option>
            <option value="user">user</option>
            <option value="email">email</option>
          </select>
          <input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="filter action (app., auth.login)"
            className="bg-slate-800 rounded-lg px-3 py-2 text-sm w-72 font-mono"
          />
        </div>
      }
    >
      {query.isLoading && <div className="text-slate-400">Loading…</div>}
      {query.error && (
        <div className="text-red-400">{(query.error as Error).message}</div>
      )}

      {items.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-900/40">
              <tr>
                <th className="px-5 py-3 font-medium whitespace-nowrap">When</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Target</th>
                <th className="px-5 py-3 font-medium">Details</th>
                <th className="px-5 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-slate-800 align-top hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className={`px-5 py-3 font-mono text-xs ${actionColor(e.action)}`}>
                    {e.action}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {e.actor?.email ?? (
                      <span className="text-slate-600">
                        {e.actorId ? "(deleted)" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {e.targetType ? (
                      <span>
                        <span className="text-slate-500">{e.targetType}:</span>{" "}
                        <span className="font-mono">
                          {e.targetId?.slice(0, 12) ?? "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs font-mono max-w-md truncate">
                    {e.diff ? JSON.stringify(e.diff) : ""}
                  </td>
                  <td className="px-5 py-3 text-slate-600 text-xs font-mono">
                    {e.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && !query.isLoading && (
        <div className="card p-12 text-center text-slate-500">
          No audit entries match the filter.
        </div>
      )}

      {query.hasNextPage && (
        <div className="mt-4 text-center">
          <button
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="bg-slate-800 hover:bg-slate-700 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </Layout>
  );
}
