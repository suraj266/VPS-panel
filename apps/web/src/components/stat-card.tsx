import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  Icon,
  accent = "indigo",
  hint,
}: {
  label: string;
  value: string | number;
  Icon: LucideIcon;
  accent?: "indigo" | "green" | "amber" | "red" | "slate";
  hint?: string;
}) {
  const accentClasses: Record<string, string> = {
    indigo: "bg-indigo-600/15 text-indigo-300 border-indigo-500/30",
    green: "bg-emerald-600/15 text-emerald-300 border-emerald-500/30",
    amber: "bg-amber-600/15 text-amber-300 border-amber-500/30",
    red: "bg-red-600/15 text-red-300 border-red-500/30",
    slate: "bg-slate-700/30 text-slate-300 border-slate-600/40",
  };

  return (
    <div className="card p-5 flex items-start justify-between">
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          {label}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
      </div>
      <div
        className={`w-10 h-10 rounded-lg border flex items-center justify-center ${accentClasses[accent]}`}
      >
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}
