import { useEffect, useState, type ReactNode } from "react";

/**
 * Right-side slide-in drawer. Backdrop dims the page; clicking it (or pressing
 * Escape, or the close button) calls onClose.
 *
 * Drives its own enter/leave animation via a one-tick delay: when `open` flips
 * true, we mount the panel with `translate-x-full`, then on the next paint
 * apply `translate-x-0` so the transition runs. On close we reverse, then
 * unmount once the transition has had time to finish — otherwise the drawer
 * would just pop out without animating.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  widthClass = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  widthClass?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next animation frame: flip to visible so the transform animates.
      const r = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(r);
    }
    setVisible(false);
    // Wait for the close transition to finish (matches `duration-200` below)
    // before tearing the drawer out of the DOM.
    const t = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  // Escape key closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        onClick={onClose}
        className={
          "absolute inset-0 bg-black/60 transition-opacity duration-200 " +
          (visible ? "opacity-100" : "opacity-0")
        }
      />
      <aside
        className={
          `absolute top-0 right-0 h-full w-full ${widthClass} bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col ` +
          "transition-transform duration-200 ease-out " +
          (visible ? "translate-x-0" : "translate-x-full")
        }
      >
        <header className="flex items-start justify-between gap-4 p-4 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{title}</h2>
            {subtitle && (
              <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}
