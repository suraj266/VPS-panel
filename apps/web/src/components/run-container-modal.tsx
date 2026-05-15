import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Modal } from "./modal";

type Restart = "no" | "always" | "unless-stopped" | "on-failure";

interface CreateInput {
  image: string;
  name: string;
  ports: Array<{ host: number; container: number }>;
  env: Record<string, string>;
  restartPolicy: Restart;
}

export function RunContainerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [image, setImage] = useState("nginx:latest");
  const [name, setName] = useState("");
  const [hostPort, setHostPort] = useState("");
  const [containerPort, setContainerPort] = useState("80");
  const [envText, setEnvText] = useState("");
  const [restart, setRestart] = useState<Restart>("unless-stopped");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateInput) =>
      api<{ id: string }>("/containers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["containers"] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const ports: CreateInput["ports"] = [];
    if (hostPort && containerPort) {
      ports.push({
        host: Number(hostPort),
        container: Number(containerPort),
      });
    }
    create.mutate({
      image: image.trim(),
      name: name.trim(),
      ports,
      env: parseEnv(envText),
      restartPolicy: restart,
    });
  }

  return (
    <Modal title="Run new container" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1 text-slate-400">Image</label>
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="nginx:latest"
            required
            className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Container name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-nginx"
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]*"
            className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1 text-slate-400">
              Host port (optional)
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={hostPort}
              onChange={(e) => setHostPort(e.target.value)}
              placeholder="8080"
              className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-400">
              Container port
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={containerPort}
              onChange={(e) => setContainerPort(e.target.value)}
              placeholder="80"
              className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Env vars (KEY=VALUE per line)
          </label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={4}
            placeholder="FOO=bar"
            className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-400">
            Restart policy
          </label>
          <select
            value={restart}
            onChange={(e) => setRestart(e.target.value as Restart)}
            className="w-full bg-slate-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="unless-stopped">unless-stopped</option>
            <option value="always">always</option>
            <option value="on-failure">on-failure</option>
            <option value="no">no</option>
          </select>
        </div>

        {error && <div className="text-red-400 text-sm">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {create.isPending ? "Pulling & starting…" : "Run"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
