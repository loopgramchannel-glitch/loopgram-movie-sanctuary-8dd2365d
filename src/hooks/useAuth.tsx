// Single Firebase auth listener for the app. Role comes ONLY from the server (whoami verifies the ID token).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Auth, User } from "firebase/auth";
import { getPublicConfig, whoami, studioLogout, type SiteSettingsT } from "@/lib/studio.functions";
import type { Role } from "@/lib/auth";

type AuthState = {
  ready: boolean;
  user: { uid: string; email: string | null } | null;
  role: Role | null;
  settings: SiteSettingsT | null;
  getToken: (force?: boolean) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<Role>;
  signUp: (email: string, password: string) => Promise<Role>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

let authPromise: Promise<Auth> | null = null;
function getAuthLazy(): Promise<Auth> {
  authPromise ??= (async () => {
    const [{ initializeApp, getApps }, { getAuth }, cfg] = await Promise.all([import("firebase/app"), import("firebase/auth"), getPublicConfig()]);
    const app = getApps()[0] ?? initializeApp(cfg.firebase);
    return getAuth(app);
  })();
  return authPromise;
}

async function verifiedRole(u: User, force = false): Promise<Role | null> {
  const r = await whoami({ data: { token: await u.getIdToken(force) } });
  return r.ok ? r.role : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [settings, setSettings] = useState<SiteSettingsT | null>(null);
  const current = useRef<User | null>(null);

  useEffect(() => {
    let unsub = () => {};
    let alive = true;
    getPublicConfig().then((c) => alive && setSettings(c.settings)).catch(() => {});
    getAuthLazy().then(async (auth) => {
      const { onIdTokenChanged } = await import("firebase/auth");
      unsub = onIdTokenChanged(auth, async (u) => {
        current.current = u;
        if (!u) { if (alive) { setUser(null); setRole(null); setReady(true); } return; }
        const r = await verifiedRole(u).catch(() => null);
        if (!alive) return;
        setUser({ uid: u.uid, email: u.email }); setRole(r ?? "user"); setReady(true);
      });
    }).catch(() => alive && setReady(true));
    return () => { alive = false; unsub(); };
  }, []);

  const getToken = useCallback(async (force = false) => current.current ? current.current.getIdToken(force) : null, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = await getAuthLazy();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const r = (await verifiedRole(cred.user, true)) ?? "user";
    setUser({ uid: cred.user.uid, email: cred.user.email }); setRole(r);
    return r;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const auth = await getAuthLazy();
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const r = (await verifiedRole(cred.user, true)) ?? "user";
    setUser({ uid: cred.user.uid, email: cred.user.email }); setRole(r);
    return r;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const auth = await getAuthLazy();
    const { sendPasswordResetEmail } = await import("firebase/auth");
    // Same outcome whether or not the account exists (no enumeration).
    await sendPasswordResetEmail(auth, email.trim()).catch((e) => { if (e?.code === "auth/network-request-failed" || e?.code === "auth/too-many-requests") throw e; });
  }, []);

  const signOut = useCallback(async () => {
    const auth = await getAuthLazy();
    const u = auth.currentUser;
    if (u && role === "owner") await studioLogout({ data: { token: await u.getIdToken() } }).catch(() => {});
    const { signOut: so } = await import("firebase/auth");
    await so(auth);
    setUser(null); setRole(null);
  }, [role]);

  const value = useMemo(() => ({ ready, user, role, settings, getToken, signIn, signUp, resetPassword, signOut }), [ready, user, role, settings, getToken, signIn, signUp, resetPassword, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
