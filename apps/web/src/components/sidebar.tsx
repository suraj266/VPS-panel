import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  Container,
  ScrollText,
  Settings,
  LogOut,
  Server,
  TerminalSquare,
  Plug,
  FolderKanban,
  Activity,
} from "lucide-react";
import { api } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/projects", label: "Projects", Icon: FolderKanban },
  { to: "/apps", label: "All apps", Icon: Boxes },
  { to: "/containers", label: "Containers", Icon: Container },
  { to: "/monitoring", label: "Monitoring", Icon: Activity },
  { to: "/host", label: "Host shell", Icon: TerminalSquare },
  { to: "/integrations", label: "Integrations", Icon: Plug },
  { to: "/audit", label: "Audit log", Icon: ScrollText },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  const nav = useNavigate();

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      nav("/login");
    }
  }

  return (
    <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-950/60 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Server className="w-4 h-4 text-indigo-300" />
        </div>
        <div>
          <div className="font-semibold text-sm leading-tight">VPS Panel</div>
          <div className="text-xs text-slate-500">control center</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link-active" : "nav-link-inactive"}`
            }
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800">
        {userEmail && (
          <div className="px-3 py-2 mb-2">
            <div className="text-xs text-slate-500">signed in as</div>
            <div className="text-sm font-mono truncate">{userEmail}</div>
          </div>
        )}
        <button
          onClick={logout}
          className="nav-link nav-link-inactive w-full text-left"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
