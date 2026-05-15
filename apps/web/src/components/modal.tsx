import type { ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={`bg-slate-900 border border-slate-800 rounded-lg w-full ${maxWidth} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
