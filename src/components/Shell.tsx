import { Link, useNavigate } from "@tanstack/react-router";
import { InstallButton } from "./InstallButton";
import { LayoutDashboard, LogIn, LogOut, Compass, Home, Search, UserCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { setState, getState } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/you", label: "You", icon: UserCircle2 },
] as const;

/** Turn on data saver automatically once on 2G / Data Saver connections (viewer can switch it off). */
function autoLowData() {
  const c = (navigator as any).connection;
  const slow = !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ""));
  if (!slow || localStorage.getItem("loopgram:autolow")) return;
  localStorage.setItem("loopgram:autolow", "1");
  if (!getState().lowData) setState((s) => ({ ...s, lowData: true }));
}

export function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const auth = useAuth();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    autoLowData();
    on(); addEventListener("online", on); addEventListener("offline", on);
    if ("serviceWorker" in navigator) {
      const h = location.hostname;
      const blocked = !import.meta.env.PROD || window.self !== window.top || /^(id-)?preview--/.test(h) || /(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h) || new URLSearchParams(location.search).get("sw") === "off";
      if (blocked) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.active?.scriptURL.endsWith("/sw.js") && r.unregister())).catch(() => {});
      else navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => { removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-4">
        <Link to="/" className="flex min-w-0 items-center gap-1.5 text-base font-black tracking-tight sm:text-lg" aria-label="LoopgramChannel home">
          <img src="/icon.svg" alt="" className="h-7 w-7 shrink-0" /><span className="truncate">LoopgramChannel</span>
        </Link>
        <form className="mx-auto hidden max-w-xl flex-1 md:flex" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav({ to: "/search", search: { q: q.trim() } }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search"
            className="h-10 flex-1 rounded-l-full border bg-background px-4 text-sm outline-none focus:border-ring" />
          <button className="h-10 rounded-r-full border border-l-0 bg-secondary px-5" aria-label="Submit search"><Search className="h-4 w-4" /></button>
        </form>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1 md:ml-0">
          <InstallButton />
          <Link to="/search" search={{ q: "" }} className="rounded-full p-2 hover:bg-accent md:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
          {auth.ready && !auth.user && (
            <Link to="/login" aria-label="Sign in" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border p-2 text-sm hover:bg-accent sm:px-3 sm:py-1.5"><LogIn className="h-4 w-4" /><span className="hidden sm:inline">Sign in</span></Link>
          )}
          {auth.user && auth.role === "owner" && (
            <Link to="/studio" className="rounded-full p-2 hover:bg-accent" aria-label="Open Studio" title="Studio"><LayoutDashboard className="h-5 w-5" /></Link>
          )}
          {auth.user && (
            <button onClick={async () => { await qc.cancelQueries(); await auth.signOut(); nav({ to: "/", replace: true }); }} className="rounded-full p-2 hover:bg-accent" aria-label={`Sign out ${auth.user.email ?? ""}`} title="Sign out"><LogOut className="h-5 w-5" /></button>
          )}
        </div>
      </header>
      <div className="flex">
        <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-20 shrink-0 flex-col items-center gap-1 pt-2 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }} activeOptions={{ exact: n.to === "/" }}>
              <n.icon className="h-5 w-5" />{n.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          {offline && <p className="bg-secondary px-4 py-2 text-center text-xs">You're offline. Showing saved content where available.</p>}
          {children}
        </main>
      </div>
      <footer className="mt-8">
        <div aria-hidden className="md:hidden" style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }} />
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 backdrop-blur md:hidden" aria-label="Main mobile" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground" activeProps={{ className: "!text-foreground font-bold" }} activeOptions={{ exact: n.to === "/" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
