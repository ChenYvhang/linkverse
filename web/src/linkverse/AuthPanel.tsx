import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { signInWithPassword, signOut, signUpWithPassword } from "./auth";
import { isSupabaseConfigured } from "./supabaseClient";

/**
 * Sign-in strip for the tracking pipeline. Shown above it rather than as a
 * global header control, because the account only matters for that one
 * feature — everything else in the app works the same signed in or out.
 */
export default function AuthPanel({ user, syncing }: { user: User | null; syncing: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  if (!isSupabaseConfigured) {
    return (
      <p className="text-xs text-muted mb-3">
        Tracked in this browser only. Accounts aren't configured for this deployment, so this
        pipeline won't follow you to another device.
      </p>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted mb-3">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
        Synced as <span className="text-ink font-medium">{user.email}</span>
        {syncing && <span className="text-muted">· syncing…</span>}
        <button onClick={() => void signOut()} className="ml-auto text-accent hover:underline">
          Sign out
        </button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fn = mode === "signin" ? signInWithPassword : signUpWithPassword;
    const err = await fn(email, password);
    setBusy(false);
    if (err) {
      setError(err);
    } else if (mode === "signup") {
      setConfirmSent(true);
    }
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-xs text-muted hover:text-ink transition-colors"
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-line text-xs leading-none shrink-0">
          {open ? "−" : "+"}
        </span>
        Tracked in this browser only —{" "}
        <span className="text-accent font-medium">sign in to sync across devices</span>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-line p-3 max-w-sm">
          {confirmSent ? (
            <p className="text-xs text-muted">
              Check <span className="text-ink">{email}</span> for a confirmation link, then sign in.
            </p>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-2">
              <div className="flex gap-1 mb-1">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`px-2 py-0.5 rounded-full text-[11px] border ${
                    mode === "signin" ? "bg-accent-fill text-white border-accent-fill" : "border-line text-muted"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`px-2 py-0.5 rounded-full text-[11px] border ${
                    mode === "signup" ? "bg-accent-fill text-white border-accent-fill" : "border-line text-muted"
                  }`}
                >
                  Create account
                </button>
              </div>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-line bg-surface text-ink placeholder:text-muted focus:outline-none focus:border-accent"
              />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-line bg-surface text-ink placeholder:text-muted focus:outline-none focus:border-accent"
              />
              {error && <p className="text-[11px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full px-2.5 py-1.5 text-xs font-medium rounded-lg bg-accent-fill text-white disabled:opacity-60"
              >
                {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
