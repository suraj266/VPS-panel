import { useState, type FormEvent } from "react";
import Editor from "@monaco-editor/react";
import { FolderTree, Save, AlertTriangle, RefreshCw } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Modal } from "./modal";

interface ReadResult {
  content: string;
  size: number;
  encoding: "utf8" | "base64";
  mode: number;
}

interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mode: string;
  mtime: string;
}

interface DirListing {
  path: string;
  entries: DirEntry[];
}

const COMMON_PATHS = [
  "/etc/nginx/nginx.conf",
  "/etc/nginx/conf.d/default.conf",
  "/etc/hosts",
  "/etc/environment",
  "/app/.env",
  "/usr/share/nginx/html/index.html",
];

function languageFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".conf") || lower.endsWith("nginx.conf")) return "ini";
  if (lower.endsWith(".env") || lower.includes("/.env")) return "ini";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "javascript";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".dockerfile") || lower.endsWith("Dockerfile"))
    return "dockerfile";
  if (lower.endsWith(".md")) return "markdown";
  return "plaintext";
}

export function FileEditorModal({
  containerId,
  containerName,
  onClose,
}: {
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  const [path, setPath] = useState("/etc/hosts");
  const [content, setContent] = useState("");
  const [encoding, setEncoding] = useState<"utf8" | "base64">("utf8");
  const [dirty, setDirty] = useState(false);
  const [browserPath, setBrowserPath] = useState("/");
  const [showBrowser, setShowBrowser] = useState(false);

  const file = useQuery({
    queryKey: ["file", containerId, path],
    queryFn: () =>
      api<ReadResult>(
        `/containers/${containerId}/file?path=${encodeURIComponent(path)}`,
      ),
    enabled: false,
    retry: false,
  });

  const dir = useQuery({
    queryKey: ["dir", containerId, browserPath],
    queryFn: () =>
      api<DirListing>(
        `/containers/${containerId}/files?path=${encodeURIComponent(browserPath)}`,
      ),
    enabled: showBrowser,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/containers/${containerId}/file?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        body: JSON.stringify({ content, encoding }),
      }),
    onSuccess: () => setDirty(false),
  });

  function onLoad(e: FormEvent) {
    e.preventDefault();
    file
      .refetch()
      .then((r) => {
        if (r.data) {
          setContent(r.data.content);
          setEncoding(r.data.encoding);
          setDirty(false);
        }
      });
  }

  function openFromBrowser(name: string, type: string) {
    const full =
      browserPath === "/" ? `/${name}` : `${browserPath.replace(/\/$/, "")}/${name}`;
    if (type === "dir") {
      setBrowserPath(full);
      return;
    }
    setPath(full);
    setShowBrowser(false);
    setTimeout(() => file.refetch().then((r) => {
      if (r.data) {
        setContent(r.data.content);
        setEncoding(r.data.encoding);
        setDirty(false);
      }
    }), 0);
  }

  function goUp() {
    if (browserPath === "/") return;
    const parts = browserPath.split("/").filter(Boolean);
    parts.pop();
    setBrowserPath("/" + parts.join("/"));
  }

  return (
    <Modal
      title={`Files — ${containerName}`}
      onClose={onClose}
      maxWidth="max-w-6xl"
    >
      <form onSubmit={onLoad} className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShowBrowser((b) => !b)}
          className="inline-flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5"
          title="Browse files"
        >
          <FolderTree className="w-3.5 h-3.5" />
          Browse
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path/to/file"
          className="flex-1 bg-slate-800 rounded px-3 py-1.5 font-mono text-xs"
        />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setPath(e.target.value);
          }}
          className="bg-slate-800 rounded px-2 py-1.5 text-xs"
        >
          <option value="">common paths…</option>
          {COMMON_PATHS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={file.isFetching}
          className="inline-flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {file.isFetching ? "Loading…" : "Open"}
        </button>
      </form>

      {showBrowser && (
        <div className="mb-3 card max-h-64 overflow-auto">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 text-xs">
            <button
              onClick={goUp}
              disabled={browserPath === "/"}
              className="text-slate-400 hover:text-white disabled:opacity-40"
            >
              ↑ up
            </button>
            <span className="font-mono text-slate-500">{browserPath}</span>
          </div>
          {dir.isFetching && (
            <div className="px-3 py-2 text-xs text-slate-400">Loading…</div>
          )}
          {dir.error && (
            <div className="px-3 py-2 text-xs text-red-400">
              {(dir.error as Error).message}
            </div>
          )}
          {dir.data?.entries.map((e) => (
            <button
              key={e.name}
              onClick={() => openFromBrowser(e.name, e.type)}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800/50 flex items-center gap-2 text-xs"
            >
              <span className="text-slate-500 w-4">
                {e.type === "dir" ? "📁" : e.type === "symlink" ? "🔗" : "📄"}
              </span>
              <span className={e.type === "dir" ? "text-indigo-300" : ""}>
                {e.name}
              </span>
              <span className="ml-auto text-slate-600 font-mono">
                {e.mode} · {e.size}B
              </span>
            </button>
          ))}
        </div>
      )}

      {file.error && (
        <div className="text-red-400 text-sm mb-3 bg-red-950/40 border border-red-900/50 rounded p-2">
          {(file.error as Error).message}
        </div>
      )}

      {encoding === "base64" && (
        <div className="flex items-center gap-2 text-xs text-amber-400 mb-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          Binary file (base64-encoded). Editing not recommended.
        </div>
      )}

      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <Editor
          height="55vh"
          language={languageFor(path)}
          path={path}
          value={content}
          theme="vs-dark"
          onChange={(v) => {
            setContent(v ?? "");
            setDirty(true);
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            tabSize: 2,
            wordWrap: "on",
            readOnly: encoding === "base64",
          }}
        />
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-slate-500">
          {dirty ? (
            <span className="text-amber-400">Unsaved changes</span>
          ) : file.data ? (
            <span>
              {file.data.size} bytes · mode {file.data.mode.toString(8)}
            </span>
          ) : (
            "Open a file to edit it. Changes are written into the running container."
          )}
        </div>
        <div className="flex items-center gap-2">
          {save.error && (
            <span className="text-red-400 text-xs">
              {(save.error as Error).message}
            </span>
          )}
          {save.isSuccess && !dirty && (
            <span className="text-emerald-400 text-xs">Saved ✓</span>
          )}
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || !file.data}
            className="inline-flex items-center gap-1 text-sm bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-3">
        Changes are written directly into the container filesystem. They will be
        lost on the next deploy / container recreation. For permanent changes,
        edit the source repo and redeploy.
      </p>
    </Modal>
  );
}
