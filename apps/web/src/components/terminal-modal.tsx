import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Modal } from "./modal";

type ConnState = "connecting" | "open" | "closed" | "error";

export function TerminalModal({
  containerId,
  containerName,
  onClose,
}: {
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [shell, setShell] = useState<"/bin/sh" | "/bin/bash">("/bin/sh");
  const [connectKey, setConnectKey] = useState(0);

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
    const wsUrl = `${proto}://${window.location.host}/api/containers/${containerId}/terminal?cmd=${encodeURIComponent(shell)}`;
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
        // ignore
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
  }, [containerId, shell, connectKey]);

  return (
    <Modal
      title={`Terminal — ${containerName}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="flex items-center justify-between mb-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={
              state === "open"
                ? "text-green-400"
                : state === "connecting"
                  ? "text-amber-400"
                  : "text-red-400"
            }
          >
            ● {state}
          </span>
          <select
            value={shell}
            onChange={(e) => setShell(e.target.value as typeof shell)}
            className="bg-slate-800 rounded px-2 py-0.5"
          >
            <option value="/bin/sh">/bin/sh</option>
            <option value="/bin/bash">/bin/bash</option>
          </select>
          {(state === "closed" || state === "error") && (
            <button
              onClick={() => setConnectKey((k) => k + 1)}
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-0.5"
            >
              Reconnect
            </button>
          )}
        </div>
        <span className="text-slate-500">
          Tip: Ctrl+C to interrupt, Ctrl+D to exit, then Reconnect
        </span>
      </div>
      <div
        ref={hostRef}
        className="h-[60vh] bg-slate-950 border border-slate-800 rounded p-1"
      />
    </Modal>
  );
}
