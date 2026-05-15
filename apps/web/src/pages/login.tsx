import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Server, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";

export function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          ...(totpCode ? { totpCode } : {}),
        }),
      });
      nav("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "login failed";
      // The API returns the literal string "TOTP code required" / "invalid TOTP code"
      // along with `needsTotp: true`. We just check the message — simplest.
      if (
        message.toLowerCase().includes("totp") ||
        message.toLowerCase().includes("2fa")
      ) {
        setNeedsTotp(true);
        setError(needsTotp ? message : null);
      } else {
        setError(message);
        setNeedsTotp(false);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Server className="w-5 h-5 text-indigo-300" />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight">VPS Panel</div>
            <div className="text-xs text-slate-500">control center</div>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="card p-6 space-y-4"
        >
          <h1 className="text-base font-semibold">Sign in</h1>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          {needsTotp && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Authenticator code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                required
                autoFocus
                placeholder="123456"
                className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono tabular-nums tracking-widest text-center"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Open your authenticator app and enter the 6-digit code.
              </p>
            </div>
          )}
          {error && (
            <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 rounded-lg py-2.5 font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600 mt-6">
          Default credentials are in your <code>.env</code> file.
        </p>
      </div>
    </div>
  );
}
