import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";

type ConnState = "connecting" | "open" | "closed" | "error";

const MAX_LINES = 5000;

export function LogsModal({
  containerId,
  containerName,
  onClose,
}: {
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<ConnState>("connecting");
  const [autoScroll, setAutoScroll] = useState(true);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const preRef = useRef<HTMLPreElement>(null);
  const bufferRef = useRef("");

  useEffect(() => {
    setLines([]);
    bufferRef.current = "";
    setState("connecting");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${proto}://${window.location.host}/api/containers/${containerId}/logs/stream?tail=500`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    const flushBufferToLines = () => {
      if (!bufferRef.current.includes("\n")) return;
      const parts = bufferRef.current.split("\n");
      bufferRef.current = parts.pop() ?? "";
      if (parts.length === 0) return;
      setLines((prev) => {
        const next = prev.concat(parts);
        if (next.length > MAX_LINES) return next.slice(-MAX_LINES);
        return next;
      });
    };

    ws.addEventListener("open", () => setState("open"));
    ws.addEventListener("message", (e) => {
      let chunk: string;
      if (typeof e.data === "string") {
        chunk = e.data;
      } else {
        chunk = new TextDecoder("utf-8", { fatal: false }).decode(
          new Uint8Array(e.data as ArrayBuffer),
        );
      }
      bufferRef.current += chunk;
      flushBufferToLines();
    });
    ws.addEventListener("close", () => {
      // Flush remaining buffer as a final line
      if (bufferRef.current.length > 0) {
        setLines((prev) => prev.concat([bufferRef.current]));
        bufferRef.current = "";
      }
      setState("closed");
    });
    ws.addEventListener("error", () => setState("error"));

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [containerId, reconnectKey]);

  useEffect(() => {
    if (!autoScroll || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, autoScroll]);

  function onScroll() {
    if (!preRef.current) return;
    const el = preRef.current;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }

  return (
    <Modal
      title={`Logs — ${containerName}`}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="flex items-center justify-between mb-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={
              state === "open"
                ? "text-green-400"
                : state === "connecting"
                  ? "text-amber-400"
                  : "text-slate-400"
            }
          >
            ● {state === "open" ? "live" : state}
          </span>
          <span className="text-slate-500">
            {lines.length.toLocaleString()} lines
          </span>
          {!autoScroll && (
            <button
              onClick={() => setAutoScroll(true)}
              className="text-indigo-400 hover:text-indigo-300"
            >
              ↓ resume auto-scroll
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setLines([]);
              bufferRef.current = "";
            }}
            className="bg-slate-800 hover:bg-slate-700 rounded px-2 py-0.5"
          >
            Clear
          </button>
          {(state === "closed" || state === "error") && (
            <button
              onClick={() => setReconnectKey((k) => k + 1)}
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-0.5"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>
      <pre
        ref={preRef}
        onScroll={onScroll}
        className="bg-slate-950 border border-slate-800 rounded p-3 text-xs font-mono whitespace-pre-wrap max-h-[60vh] overflow-auto"
      >
        {lines.length === 0
          ? state === "connecting"
            ? "(connecting…)"
            : "(no logs)"
          : lines.join("\n")}
      </pre>
    </Modal>
  );
}
