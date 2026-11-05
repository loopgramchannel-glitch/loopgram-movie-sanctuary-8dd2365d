import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, LogIn, LogOut, Settings, UserCircle2 } from "lucide-react";
import { Page } from "@/components/lg";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/you")({
  head: () => ({
    meta: [
      { title: "You — LoopgramChannel" },
      { name: "description", content: "Sign in to LoopgramChannel and manage your account." },
      { property: "og:title", content: "You — LoopgramChannel" },
      { property: "og:description", content: "Sign in to LoopgramChannel and manage your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: YouPage,
});

function YouPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const row = "flex items-center gap-4 rounded-xl px-4 py-3 hover:bg-accent";
  if (!auth.ready) return <Page><p className="p-8 text-center text-sm text-muted-foreground">Loading…</p></Page>;
  if (!auth.user) {
    return (
      <Page>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
          <UserCircle2 className="h-24 w-24 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Enjoy your favorite videos</h1>
          <p className="text-sm text-muted-foreground">Sign in to like videos, comment and save your favorites.</p>
          <Link to="/login" search={{ redirect: "/you" }} className="inline-flex items-center gap-2 rounded-full border px-5 py-2 font-medium text-primary hover:bg-accent"><LogIn className="h-5 w-5" />Sign in</Link>
        </div>
      </Page>
    );
  }
  const email = auth.user.email ?? "";
  return (
    <Page>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="flex items-center gap-4 pb-6">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">{(email[0] ?? "U").toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{email.split("@")[0] || "You"}</h1>
            <p className="truncate text-sm text-muted-foreground">{email}{auth.role === "owner" ? " · Owner" : ""}</p>
          </div>
        </div>
        <div className="space-y-1 border-t pt-3">
          {auth.role === "owner" && <Link to="/studio" className={row}><LayoutDashboard className="h-5 w-5" />Studio</Link>}
          <Link to="/settings" className={row}><Settings className="h-5 w-5" />Settings</Link>
          <button className={`${row} w-full text-left`} onClick={async () => { await qc.cancelQueries(); await auth.signOut(); nav({ to: "/", replace: true }); }}><LogOut className="h-5 w-5" />Sign out</button>
        </div>
      </div>
    </Page>
  );
}
