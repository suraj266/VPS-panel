import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle, Server, ChevronDown } from "lucide-react";
import { Layout } from "../components/layout";

type ConnState = "connecting" | "open" | "closed" | "error";

const HOST_CONTAINER = "panel_host";

// Available entry-point shells. `chroot /host` gives a real root shell on the
// host filesystem with /host as /. Otherwise you're inside the alpine
// container that has the host mounted at /host.
const SHELLS: Array<{ value: string; label: string; description: string }> = [
  {
    value: "/bin/bash",
    label: "container bash",
    description: "bash inside panel_host. Host fs is at /host.",
  },
  {
    value: "/bin/sh",
    label: "container sh",
    description: "POSIX sh inside panel_host.",
  },
];

export function HostShellPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [shell, setShell] = useState<string>("/bin/bash");
  const [connectKey, setConnectKey] = useState(0);
  const [showShellMenu, setShowShellMenu] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#a5b4fc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${proto}://${window.location.host}/api/containers/${HOST_CONTAINER}/terminal?cmd=${encodeURIComponent(shell)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      setState("open");
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
      term.focus();
    });

    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") {
        term.write(e.data);
      } else {
        term.write(new Uint8Array(e.data as ArrayBuffer));
      }
    });
    ws.addEventListener("close", () => setState("closed"));
    ws.addEventListener("error", () => setState("error"));

    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const onWindowResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
    };
  }, [shell, connectKey]);

  return (
    <Layout
      title="Host shell"
      subtitle="Privileged shell on the VPS host (via panel_host container)"
      actions={
        <div className="flex items-center gap-2 text-xs">
          <span
            className={
              state === "open"
                ? "inline-flex items-center gap-1 text-emerald-400"
                : state === "connecting"
                  ? "inline-flex items-center gap-1 text-amber-400"
                  : "inline-flex items-center gap-1 text-red-400"
            }
          >
            <Server className="w-3.5 h-3.5" />
            {state === "open" ? "connected" : state}
          </span>

          <div className="relative">
            <button
              onClick={() => setShowShellMenu((s) => !s)}
              className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5"
            >
              <span className="font-mono">{shell}</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showShellMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-800 rounded-lg shadow-lg w-72 z-10">
                {SHELLS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => {
                      setShell(s.value);
                      setShowShellMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/60 border-b border-slate-800 last:border-b-0"
                  >
                    <div className="font-mono text-xs">{s.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {s.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {(state === "closed" || state === "error") && (
            <button
              onClick={() => setConnectKey((k) => k + 1)}
              className="bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-1.5"
            >
              Reconnect
            </button>
          )}
        </div>
      }
    >
      <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-3 mb-4 text-xs text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div>
            You are root inside the <code>panel_host</code> container, which has
            the VPS host filesystem mounted at <code>/host</code> and shares the
            host PID + network namespaces.
          </div>
          <div className="text-amber-300/80">
            For a true host-root shell, run:{" "}
            <code className="font-mono">chroot /host /bin/bash</code>
          </div>
        </div>
      </div>

      <div
        ref={hostRef}
        className="bg-slate-950 border border-slate-800 rounded-lg p-1"
        style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}
      />
    </Layout>
  );
}
