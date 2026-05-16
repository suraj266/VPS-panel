import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Copy,
  Download,
  Trash2,
  Database,
  RefreshCw,
  Globe,
  Network,
  Link as LinkIcon,
  Lock,
} from "lucide-react";
import { api } from "../lib/api";
import { Layout } from "../components/layout";

interface Me {
  id: string;
  email: string;
  role: string;
  totpEnabled: boolean;
}

interface SetupResult {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me"),
    staleTime: 30_000,
  });

  return (
    <Layout title="Settings" subtitle="Account and security preferences">
      <section className="card p-6 mb-6">
        <PanelDomainSection />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="card p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1">
              Account
            </h2>
            <p className="text-xs text-slate-500">
              The currently signed-in user.
            </p>
          </div>
          {me.isLoading ? (
            <div className="text-slate-400 text-sm">Loading…</div>
          ) : me.data ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Email</span>
                <span className="font-mono">{me.data.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Role</span>
                <span className="font-mono">{me.data.role}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">2FA</span>
                {me.data.totpEnabled ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" /> Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <ShieldOff className="w-3.5 h-3.5" /> Disabled
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <section className="card p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1">
              Two-factor authentication
            </h2>
            <p className="text-xs text-slate-500">
              Adds a 6-digit code from an authenticator app on top of your password.
            </p>
          </div>
          {me.isLoading ? (
            <div className="text-slate-400 text-sm">Loading…</div>
          ) : me.data?.totpEnabled ? (
            <Disable2FA
              onChanged={() => qc.invalidateQueries({ queryKey: ["me"] })}
            />
          ) : (
            <Enable2FA
              onChanged={() => qc.invalidateQueries({ queryKey: ["me"] })}
            />
          )}
        </section>
      </div>

      <section className="card p-6 mt-6">
        <NetworkSection />
      </section>

      <section className="card p-6 mt-6">
        <BackupsSection />
      </section>
    </Layout>
  );
}

function Enable2FA({ onChanged }: { onChanged: () => void }) {
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  const startSetup = useMutation({
    mutationFn: () =>
      api<SetupResult>("/auth/2fa/setup", { method: "POST" }),
    onSuccess: (r) => setSetup(r),
  });

  const verify = useMutation({
    mutationFn: () =>
      api("/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => {
      setSetup(null);
      setToken("");
      onChanged();
    },
  });

  async function copySecret() {
    if (!setup?.secret) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    verify.mutate();
  }

  if (!setup) {
    return (
      <div>
        <p className="text-sm text-slate-400 mb-4">
          Click below to generate a secret and scan the QR code with an
          authenticator app like Google Authenticator, 1Password, or Authy.
        </p>
        <button
          onClick={() => startSetup.mutate()}
          disabled={startSetup.isPending}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Smartphone className="w-4 h-4" />
          {startSetup.isPending ? "Generating…" : "Set up 2FA"}
        </button>
        {startSetup.error && (
          <div className="mt-3 text-red-400 text-sm">
            {(startSetup.error as Error).message}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-start gap-4">
        <img
          src={setup.qrDataUrl}
          alt="QR code"
          className="w-40 h-40 rounded-lg border border-slate-700 bg-slate-900"
        />
        <div className="flex-1 space-y-2 text-xs">
          <p className="text-slate-400">
            Scan with your authenticator app, or enter the secret manually:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-950 rounded px-2 py-1 font-mono break-all">
              {setup.secret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-slate-500">
            Once added to your app, enter the 6-digit code below to confirm.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
          Verification code
        </label>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          autoFocus
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
        />
      </div>

      {verify.error && (
        <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
          {(verify.error as Error).message}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={verify.isPending || token.length !== 6}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          <ShieldCheck className="w-4 h-4" />
          {verify.isPending ? "Verifying…" : "Enable 2FA"}
        </button>
        <button
          type="button"
          onClick={() => setSetup(null)}
          className="text-sm text-slate-400 hover:text-white px-3 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Disable2FA({ onChanged }: { onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);

  const disable = useMutation({
    mutationFn: () =>
      api("/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password, token }),
      }),
    onSuccess: () => {
      setPassword("");
      setToken("");
      setConfirming(false);
      onChanged();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    disable.mutate();
  }

  if (!confirming) {
    return (
      <div>
        <p className="text-sm text-slate-400 mb-4">
          Two-factor authentication is currently <b>enabled</b>. Disabling will
          remove the extra login step.
        </p>
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-2 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <ShieldOff className="w-4 h-4" />
          Disable 2FA
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-slate-400">
        Enter your password and current 6-digit code to disable 2FA.
      </p>
      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
          6-digit code
        </label>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          maxLength={6}
          placeholder="123456"
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
        />
      </div>
      {disable.error && (
        <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
          {(disable.error as Error).message}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={disable.isPending || !password || token.length !== 6}
          className="inline-flex items-center gap-2 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          <ShieldOff className="w-4 h-4" />
          {disable.isPending ? "Disabling…" : "Disable"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm text-slate-400 hover:text-white px-3 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function BackupsSection() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<{ files: BackupFile[] }>("/backups"),
    refetchInterval: 30_000,
  });

  const create = useMutation({
    mutationFn: () => api<BackupFile>("/backups", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });

  const del = useMutation({
    mutationFn: (filename: string) =>
      api(`/backups/${encodeURIComponent(filename)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" />
            Database backups
          </h2>
          <p className="text-xs text-slate-500">
            Postgres backups via <code>pg_dump</code>, gzipped. Daily automatic
            run + last 14 retained. Manual trigger via the button.
          </p>
        </div>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${create.isPending ? "animate-spin" : ""}`} />
          {create.isPending ? "Backing up…" : "Back up now"}
        </button>
      </div>

      {create.error && (
        <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 mb-3">
          {(create.error as Error).message}
        </div>
      )}
      {create.isSuccess && !create.error && (
        <div className="text-emerald-400 text-xs mb-3">
          Backup created: {create.data.filename}
        </div>
      )}

      {list.isLoading && (
        <div className="text-slate-400 text-sm">Loading…</div>
      )}
      {list.error && (
        <div className="text-red-400 text-sm">
          {(list.error as Error).message}
        </div>
      )}
      {list.data && list.data.files.length === 0 && (
        <div className="text-slate-500 text-sm p-4 text-center bg-slate-900 rounded-lg">
          No backups yet. Click "Back up now" to create the first one.
        </div>
      )}
      {list.data && list.data.files.length > 0 && (
        <div className="border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-900/40">
              <tr>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.files.map((f) => (
                <tr
                  key={f.filename}
                  className="border-t border-slate-800 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-xs">{f.filename}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">
                    {new Date(f.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums">
                    {formatBytes(f.sizeBytes)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <a
                        href={`/api/backups/${encodeURIComponent(f.filename)}/download`}
                        className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-2 py-1 text-xs"
                      >
                        <Download className="w-3 h-3" /> Download
                      </a>
                      <button
                        onClick={() => {
                          if (
                            confirm(`Delete backup "${f.filename}"?`)
                          ) {
                            del.mutate(f.filename);
                          }
                        }}
                        className="inline-flex items-center gap-1 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-md px-2 py-1 text-xs"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface NetworkAddress {
  family: "inet" | "inet6";
  address: string;
  prefixlen: number;
  scope: string;
}

interface NetworkInterface {
  name: string;
  state: string;
  mac: string | null;
  mtu: number;
  addresses: NetworkAddress[];
}

interface NetworkInfo {
  publicIPv4: string | null;
  publicIPv6: string | null;
  interfaces: NetworkInterface[];
}

function NetworkSection() {
  const net = useQuery({
    queryKey: ["network"],
    queryFn: () => api<NetworkInfo>("/network"),
    refetchInterval: 60_000,
  });
  const [copied, setCopied] = useState<string | null>(null);

  async function copyValue(v: string, key: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1 flex items-center gap-2">
            <Network className="w-4 h-4 text-slate-400" />
            Server network
          </h2>
          <p className="text-xs text-slate-500">
            Public IPs (resolved via ipify) and host interfaces from the
            privileged <code>panel_host</code> sidecar. Point your DNS A /
            AAAA records at the public addresses below.
          </p>
        </div>
        <button
          onClick={() => net.refetch()}
          disabled={net.isFetching}
          className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${net.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {net.isLoading && (
        <div className="text-slate-400 text-sm">Loading…</div>
      )}
      {net.error && (
        <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 mb-3">
          {(net.error as Error).message}
        </div>
      )}

      {net.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Public IPv4
              </div>
              {net.data.publicIPv4 ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-lg font-mono tabular-nums">
                    {net.data.publicIPv4}
                  </code>
                  <button
                    onClick={() => copyValue(net.data!.publicIPv4!, "v4")}
                    className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-2 py-1 text-xs"
                  >
                    <Copy className="w-3 h-3" />
                    {copied === "v4" ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <div className="text-slate-600 text-sm">unavailable</div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Public IPv6
              </div>
              {net.data.publicIPv6 ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono tabular-nums break-all">
                    {net.data.publicIPv6}
                  </code>
                  <button
                    onClick={() => copyValue(net.data!.publicIPv6!, "v6")}
                    className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-2 py-1 text-xs shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    {copied === "v6" ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <div className="text-slate-600 text-sm">
                  no IPv6 (host or upstream doesn't support it)
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Host interfaces
            </div>
            {net.data.interfaces.length === 0 ? (
              <div className="text-slate-500 text-sm bg-slate-950 border border-slate-800 rounded-lg p-4">
                No interfaces reported. Is <code>panel_host</code> running?
              </div>
            ) : (
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-900/40">
                    <tr>
                      <th className="px-4 py-2 font-medium">Interface</th>
                      <th className="px-4 py-2 font-medium">State</th>
                      <th className="px-4 py-2 font-medium">Addresses</th>
                      <th className="px-4 py-2 font-medium">MAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {net.data.interfaces.map((iface) => (
                      <tr
                        key={iface.name}
                        className="border-t border-slate-800 align-top hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="px-4 py-2 font-mono text-xs">
                          {iface.name}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <span
                            className={
                              iface.state === "UP"
                                ? "text-emerald-400"
                                : "text-slate-500"
                            }
                          >
                            {iface.state}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs font-mono space-y-0.5">
                          {iface.addresses.length === 0 ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            iface.addresses.map((a, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span
                                  className={
                                    a.family === "inet"
                                      ? "text-xs bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded"
                                      : "text-xs bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded"
                                  }
                                >
                                  {a.family === "inet" ? "v4" : "v6"}
                                </span>
                                <code className="break-all">
                                  {a.address}/{a.prefixlen}
                                </code>
                                {a.scope !== "global" && (
                                  <span className="text-slate-600">
                                    ({a.scope})
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs font-mono text-slate-500">
                          {iface.mac ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface PanelSettingsRow {
  panelDomain: string | null;
  panelSslEnabled: boolean;
  panelCertEmail: string | null;
  panelCertExpiresAt: string | null;
  upstream: { host: string; port: number };
}

function PanelDomainSection() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["panel-settings"],
    queryFn: () => api<PanelSettingsRow>("/panel-settings"),
  });

  const [domain, setDomain] = useState("");
  const [showSslForm, setShowSslForm] = useState(false);
  const [sslEmail, setSslEmail] = useState("");
  const [sslStaging, setSslStaging] = useState(false);

  const apply = useMutation({
    mutationFn: (newDomain: string) =>
      api<PanelSettingsRow>("/panel-settings/domain", {
        method: "PUT",
        body: JSON.stringify({ domain: newDomain }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-settings"] });
      setDomain("");
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      api("/panel-settings/domain", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["panel-settings"] }),
  });

  const issueSsl = useMutation({
    mutationFn: () =>
      api("/panel-settings/domain/ssl/issue", {
        method: "POST",
        body: JSON.stringify({ email: sslEmail, staging: sslStaging }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-settings"] });
      setShowSslForm(false);
    },
  });

  const data = settings.data;
  const hasDomain = !!data?.panelDomain;

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-1 flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-slate-400" />
            Panel domain
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            The hostname users open to reach this panel. Setting it writes the
            nginx site config + reloads. You can also issue a Let's Encrypt
            cert in one click after the DNS A record points here.
          </p>
        </div>
        {settings.isFetching && (
          <RefreshCw className="w-4 h-4 text-slate-500 animate-spin shrink-0" />
        )}
      </div>

      {settings.isLoading && (
        <div className="text-slate-400 text-sm">Loading…</div>
      )}
      {settings.error && (
        <div className="text-red-400 text-sm">
          {(settings.error as Error).message}
        </div>
      )}

      {data && (
        <>
          {hasDomain && (
            <div className="mb-4 bg-slate-950 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 mb-1">
                    Current panel URL
                  </div>
                  <a
                    href={`${data.panelSslEnabled ? "https" : "http"}://${data.panelDomain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lg font-mono text-indigo-300 hover:underline break-all"
                  >
                    {data.panelSslEnabled ? "https" : "http"}://
                    {data.panelDomain}
                  </a>
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    {data.panelSslEnabled ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded">
                        <Lock className="w-3 h-3" /> SSL active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded">
                        HTTP only
                      </span>
                    )}
                    {data.panelCertExpiresAt && (
                      <span className="text-slate-500">
                        cert expires{" "}
                        {new Date(
                          data.panelCertExpiresAt,
                        ).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Remove panel domain "${data.panelDomain}"? nginx site config will be deleted.`,
                      )
                    ) {
                      remove.mutate();
                    }
                  }}
                  className="inline-flex items-center gap-1 bg-red-800/30 hover:bg-red-800/50 border border-red-800/40 text-red-200 rounded-md px-2 py-1 text-xs shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                  Remove
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (domain) apply.mutate(domain);
            }}
            className="flex items-end gap-2 mb-3"
          >
            <div className="flex-1">
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                {hasDomain ? "Change to" : "Set domain"}
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
                placeholder="panel.example.com"
                required
                pattern="[a-zA-Z0-9.\\-]+"
                className="w-full bg-slate-800 rounded-lg px-3 py-2 font-mono text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={apply.isPending || !domain}
              className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </button>
          </form>

          {apply.error && (
            <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 mb-3">
              {(apply.error as Error).message}
            </div>
          )}

          {hasDomain && !data.panelSslEnabled && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
              {!showSslForm ? (
                <button
                  onClick={() => setShowSslForm(true)}
                  className="inline-flex items-center gap-2 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-700/40 text-emerald-200 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  <Lock className="w-4 h-4" />
                  Issue Let's Encrypt cert
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    issueSsl.mutate();
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">
                      Email (for Let's Encrypt expiry notices)
                    </label>
                    <input
                      type="email"
                      value={sslEmail}
                      onChange={(e) => setSslEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className="w-full bg-slate-800 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={sslStaging}
                      onChange={(e) => setSslStaging(e.target.checked)}
                    />
                    Use Let's Encrypt staging (for testing only — staging certs
                    are NOT trusted by browsers)
                  </label>
                  {sslStaging && (
                    <div className="text-xs bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2 text-amber-200">
                      Staging certs are signed by "Fake LE Intermediate" and
                      browsers will keep showing "Not secure". Only enable this
                      if you're debugging cert issuance and don't care about
                      browser trust. For real use, leave this <b>unchecked</b>.
                    </div>
                  )}
                  {issueSsl.error && (
                    <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
                      {(issueSsl.error as Error).message}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={issueSsl.isPending || !sslEmail}
                      className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {issueSsl.isPending ? "Issuing…" : "Issue cert"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSslForm(false)}
                      className="text-sm text-slate-400 hover:text-white px-3 py-2"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    DNS A record for{" "}
                    <code className="bg-slate-800 px-1 rounded">
                      {data.panelDomain}
                    </code>{" "}
                    must already point to this VPS, otherwise the HTTP-01
                    challenge fails.
                  </p>
                </form>
              )}
            </div>
          )}

          {hasDomain && (
            <DomainHealthCheck domain={data.panelDomain!} />
          )}
          {!hasDomain && <PublicIpHint />}

          <p className="text-xs text-slate-600 mt-3">
            nginx upstream:{" "}
            <code className="bg-slate-800 px-1 rounded">
              {data.upstream.host}:{data.upstream.port}
            </code>{" "}
            — override with <code>PANEL_UPSTREAM_HOST</code> /{" "}
            <code>PANEL_UPSTREAM_PORT</code> env vars.
          </p>
        </>
      )}
    </>
  );
}

interface DomainHealth {
  domain: string;
  publicIPv4: string | null;
  publicIPv6: string | null;
  dns: {
    a: string[];
    aaaa: string[];
    ipv4Match: boolean;
    ipv6Match: boolean;
  };
  http: { ok: boolean; status?: number; error?: string; latencyMs?: number };
  https: { ok: boolean; status?: number; error?: string; latencyMs?: number };
}

function DomainHealthCheck({ domain }: { domain: string }) {
  const health = useQuery({
    queryKey: ["panel-domain-health", domain],
    queryFn: () =>
      api<DomainHealth>(
        `/panel-settings/domain/health-check?domain=${encodeURIComponent(domain)}`,
      ),
    refetchInterval: 60_000,
    retry: false,
  });

  return (
    <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Domain health
        </div>
        <button
          onClick={() => health.refetch()}
          disabled={health.isFetching}
          className="inline-flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3 h-3 ${health.isFetching ? "animate-spin" : ""}`}
          />
          {health.isFetching ? "Checking…" : "Re-check"}
        </button>
      </div>

      {health.isLoading && (
        <div className="text-xs text-slate-500">Running checks…</div>
      )}
      {health.error && (
        <div className="text-xs text-red-400">
          {(health.error as Error).message}
        </div>
      )}

      {health.data && (
        <ul className="space-y-1.5 text-xs">
          <HealthRow
            ok={health.data.dns.ipv4Match}
            label={`DNS A record → ${health.data.publicIPv4 ?? "?"}`}
            detail={
              health.data.dns.a.length === 0
                ? "no A record resolves"
                : `resolves to ${health.data.dns.a.join(", ")}`
            }
          />
          {health.data.publicIPv6 && (
            <HealthRow
              ok={health.data.dns.ipv6Match}
              label={`DNS AAAA record → ${health.data.publicIPv6}`}
              detail={
                health.data.dns.aaaa.length === 0
                  ? "no AAAA record (fine if you don't need IPv6)"
                  : `resolves to ${health.data.dns.aaaa.join(", ")}`
              }
              warnIfMissing
            />
          )}
          <HealthRow
            ok={health.data.http.ok}
            label="HTTP reaches the panel"
            detail={
              health.data.http.ok
                ? `status ${health.data.http.status} · ${health.data.http.latencyMs}ms`
                : (health.data.http.error ??
                  `status ${health.data.http.status ?? "?"}`)
            }
          />
          <HealthRow
            ok={health.data.https.ok}
            label="HTTPS reaches the panel"
            detail={
              health.data.https.ok
                ? `status ${health.data.https.status} · ${health.data.https.latencyMs}ms`
                : (health.data.https.error ??
                  `status ${health.data.https.status ?? "—"}`)
            }
            warnIfMissing
          />
        </ul>
      )}
    </div>
  );
}

function HealthRow({
  ok,
  label,
  detail,
  warnIfMissing,
}: {
  ok: boolean;
  label: string;
  detail?: string;
  warnIfMissing?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5">
        {ok ? (
          <span className="inline-block w-3.5 h-3.5 rounded-full bg-emerald-500/30 border border-emerald-500 text-emerald-300 text-[10px] leading-[12px] text-center">
            ✓
          </span>
        ) : (
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full text-[10px] leading-[12px] text-center ${
              warnIfMissing
                ? "bg-amber-500/30 border border-amber-500 text-amber-300"
                : "bg-red-500/30 border border-red-500 text-red-300"
            }`}
          >
            ×
          </span>
        )}
      </span>
      <div className="min-w-0">
        <div className={ok ? "text-slate-200" : "text-slate-300"}>{label}</div>
        {detail && (
          <div className="text-slate-500 font-mono text-[11px]">{detail}</div>
        )}
      </div>
    </li>
  );
}

interface NetworkInfoMini {
  publicIPv4: string | null;
  publicIPv6: string | null;
}

function PublicIpHint() {
  const net = useQuery({
    queryKey: ["network"],
    queryFn: () => api<NetworkInfoMini>("/network"),
    staleTime: 60_000,
  });
  if (!net.data?.publicIPv4 && !net.data?.publicIPv6) return null;
  return (
    <div className="mt-3 bg-indigo-600/10 border border-indigo-500/30 rounded-lg p-3 text-xs">
      <div className="text-indigo-300 mb-1 font-medium">
        Point DNS at this VPS
      </div>
      <div className="text-slate-300 space-y-0.5 font-mono">
        {net.data.publicIPv4 && (
          <div>
            <span className="text-slate-500">A     </span>
            panel.yourdomain.com → {net.data.publicIPv4}
          </div>
        )}
        {net.data.publicIPv6 && (
          <div>
            <span className="text-slate-500">AAAA  </span>
            panel.yourdomain.com → {net.data.publicIPv6}
          </div>
        )}
      </div>
    </div>
  );
}
