import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm ${
    isActive
      ? "bg-slate-800 text-white"
      : "text-slate-400 hover:text-white hover:bg-slate-900"
  }`;

export function Nav() {
  const nav = useNavigate();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    nav("/login");
  }

  return (
    <header className="border-b border-slate-800 mb-6">
      <div className="max-w-6xl mx-auto px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="font-semibold mr-4">VPS Panel</span>
          <NavLink to="/apps" className={linkClass}>
            Apps
          </NavLink>
          <NavLink to="/containers" className={linkClass}>
            Containers
          </NavLink>
          <NavLink to="/audit" className={linkClass}>
            Audit
          </NavLink>
        </div>
        <button
          onClick={logout}
          className="text-sm bg-slate-800 hover:bg-slate-700 rounded px-3 py-1"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
