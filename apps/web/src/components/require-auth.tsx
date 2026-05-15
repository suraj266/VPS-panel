import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";

export function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "no">("loading");

  useEffect(() => {
    api("/auth/me")
      .then(() => setState("ok"))
      .catch(() => setState("no"));
  }, []);

  if (state === "loading") {
    return <div className="p-8 text-slate-400">Loading…</div>;
  }
  if (state === "no") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
