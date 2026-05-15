import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Globe, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { Sidebar } from "./sidebar";

interface CurrentUser {
  id: string;
  email: string;
  role: string;
}

interface PanelSettingsRow {
  panelDomain: string | null;
  panelSslEnabled: boolean;
}

export function Layout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<CurrentUser>("/auth/me"),
    staleTime: 60_000,
  });

  const panel = useQuery({
    queryKey: ["panel-settings"],
    queryFn: () => api<PanelSettingsRow>("/panel-settings"),
    staleTime: 30_000,
    retry: false,
  });

  // Show the setup banner everywhere EXCEPT on the settings page itself
  // (the user is already where they need to be).
  const showSetupBanner =
    panel.data &&
    !panel.data.panelDomain &&
    !location.pathname.startsWith("/settings");

  return (
    <div className="h-full flex bg-slate-950 text-slate-100">
      <Sidebar userEmail={me.data?.email ?? null} />

      <main className="flex-1 overflow-auto">
        {showSetupBanner && (
          <Link
            to="/settings"
            className="block bg-indigo-600/15 border-b border-indigo-500/30 hover:bg-indigo-600/25 transition-colors"
          >
            <div className="px-8 py-2.5 flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-4 h-4 text-indigo-300 shrink-0" />
                <span className="text-indigo-100">
                  Set up the panel domain so you can reach this dashboard at
                  a real hostname with HTTPS.
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-indigo-300 shrink-0">
                Set up
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </Link>
        )}

        <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
          <div className="px-8 py-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">{title}</h1>
              {subtitle && (
                <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-2">{actions}</div>
            )}
          </div>
        </header>

        <div className="px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
