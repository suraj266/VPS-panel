import { useEffect, useRef, useState } from "react";

type ConnState = "connecting" | "open" | "closed" | "error";

const MAX_LINES = 5000;

interface LogStreamViewProps {
  containerId: string;
  /**
   * How many lines of history to fetch on connect. Defaults to 500.
   */
  tail?: number;
  /**
   * CSS height for the log pane. Use vh inside modals, fixed px when
   * embedding under a sidebar layout.
   */
  height?: string;
}

/**
 * Live log stream from `/api/containers/:id/logs/stream` rendered as a
 * scrollable monospace pane. Auto-scrolls to bottom while the user is at the
 * bottom; pauses auto-scroll the moment they scroll up, with a one-click
 * "resume" button to jump back.
 *
 * No <Modal> wrapper — designed to be embedded both inside the legacy
 * LogsModal and inline in the app detail sidebar.
 */
export function LogStreamView({
  containerId,
  tail = 500,
  height = "60vh",
}: LogStreamViewProps) {
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
    const wsUrl = `${proto}://${window.location.host}/api/containers/${containerId}/logs/stream?tail=${tail}`;
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
  }, [containerId, tail, reconnectKey]);

  useEffect(() => {
    if (!autoScroll || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, autoScroll]);

  function onScroll() {
    if (!preRef.current) return;
    const el = preRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }

  return (
    <div>
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
        style={{ height, maxHeight: height }}
        className="bg-slate-950 border border-slate-800 rounded p-3 text-xs font-mono whitespace-pre-wrap overflow-auto"
      >
        {lines.length === 0
          ? state === "connecting"
            ? "(connecting…)"
            : "(no logs)"
          : lines.join("\n")}
      </pre>
    </div>
  );
}
