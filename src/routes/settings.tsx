import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Info, LayoutDashboard, LogIn, LogOut, Mail, User, Wifi } from "lucide-react";
import { Page } from "@/components/lg";
import { useAuth } from "@/hooks/useAuth";
import { setState, useStore } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LoopgramChannel" },
      { name: "description", content: "Manage your LoopgramChannel account and playback." },
      { property: "og:title", content: "Settings — LoopgramChannel" },
      { property: "og:description", content: "Account and playback settings for LoopgramChannel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function Section({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card">
      <h2 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-bold uppercase tracking-wide text-muted-foreground"><Icon className="h-4 w-4" />{title}</h2>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function SettingsPage() {
  const { ready, user, role, signOut } = useAuth();
  const nav = useNavigate();
  const lowData = useStore((s) => s.lowData);

  return (
    <Page title="Settings">
      <div className="mx-auto max-w-2xl space-y-4 px-4">
        <Section title="Account" icon={User}>
          {!ready ? <Row label="Loading…" /> : user ? (
            <>
              <Row label={user.email ?? "Signed in"} hint={role === "owner" ? "Owner" : "Member"} />
              {role === "owner" && <Link to="/studio" className="block"><Row label="Studio" hint="Manage videos and ads"><LayoutDashboard className="h-4 w-4" /><ChevronRight className="h-4 w-4 text-muted-foreground" /></Row></Link>}
              <button className="block w-full text-left" onClick={async () => { await signOut(); nav({ to: "/" }); }}><Row label="Sign out"><LogOut className="h-4 w-4 text-destructive" /></Row></button>
            </>
          ) : (
            <Link to="/login" className="block"><Row label="Sign in" hint="Sign in to like and save videos"><LogIn className="h-4 w-4" /></Row></Link>
          )}
        </Section>

        <Section title="Playback" icon={Wifi}>
          <Row label="Data saver" hint="Smaller pictures to save mobile data"><Toggle label="Data saver" on={lowData} onChange={(v) => setState((s) => ({ ...s, lowData: v }))} /></Row>
        </Section>

        <Section title="About" icon={Info}>
          <a href="mailto:loopgramchannel@gmail.com" className="block"><Row label="Contact support" hint="loopgramchannel@gmail.com"><Mail className="h-4 w-4" /></Row></a>
        </Section>
      </div>
    </Page>
  );
}
