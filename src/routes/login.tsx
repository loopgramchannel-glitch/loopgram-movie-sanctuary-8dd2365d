import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { authErrorMessage, backoffMs, destinationFor, validateCredentials } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().max(500).optional() }),
  head: () => ({
    meta: [
      { title: "Sign in — LoopgramChannel" },
      { name: "description", content: "Sign in to LoopgramChannel with your email and password." },
      { property: "og:title", content: "Sign in — LoopgramChannel" },
      { property: "og:description", content: "Sign in to LoopgramChannel with your email and password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup" | "reset";

function LoginPage() {
  const { redirect } = Route.useSearch();
  const auth = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const failures = useRef(0);
  const [waitUntil, setWaitUntil] = useState(0);

  // Already signed in: go straight to the right place.
  useEffect(() => {
    if (auth.ready && auth.user && auth.role) nav({ to: destinationFor(auth.role, redirect), replace: true });
  }, [auth.ready, auth.user, auth.role]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null); setNotice(null);
    if (Date.now() < waitUntil) { setError(`Please wait ${Math.ceil((waitUntil - Date.now()) / 1000)}s before trying again.`); return; }
    if (mode === "reset") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email address."); return; }
      setBusy(true);
      try { await auth.resetPassword(email); setNotice("If an account exists for that email, a reset link is on its way."); }
      catch (err: any) { setError(authErrorMessage(err?.code)); }
      finally { setBusy(false); }
      return;
    }
    const v = validateCredentials(email, password);
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const role = mode === "signup" ? await auth.signUp(email, password) : await auth.signIn(email, password);
      failures.current = 0; setPassword("");
      nav({ to: destinationFor(role, redirect), replace: true });
    } catch (err: any) {
      failures.current++;
      const wait = backoffMs(failures.current);
      if (wait) setWaitUntil(Date.now() + wait);
      setError(authErrorMessage(err?.code));
    } finally { setBusy(false); }
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset password";
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <h1 className="text-2xl font-black tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{mode === "reset" ? "We'll email you a link to choose a new password." : "Use your email and password."}</p>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">Email address</label>
            <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
          </div>
          {mode !== "reset" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                {mode === "signin" && <button type="button" onClick={() => { setMode("reset"); setError(null); }} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Forgot password?</button>}
              </div>
              <div className="relative">
                <input id="password" type={show ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-lg border bg-background pl-3 pr-11 text-base outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
                  className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="rounded-lg border bg-secondary px-3 py-2 text-sm">{notice}</p>}
          <button type="submit" disabled={busy || !auth.ready} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>New to LoopgramChannel? <button type="button" onClick={() => { setMode("signup"); setError(null); }} className="font-semibold text-foreground hover:underline">Create an account</button></>
          ) : (
            <button type="button" onClick={() => { setMode("signin"); setError(null); setNotice(null); }} className="font-semibold text-foreground hover:underline">Back to sign in</button>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground"><Link to="/" className="hover:underline">Continue without signing in</Link></p>
      </div>
    </div>
  );
}
