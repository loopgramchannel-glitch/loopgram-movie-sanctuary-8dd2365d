import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Activity, Ban, CheckCircle2, ChevronLeft, ChevronRight, Database, FileText, Film, Home, Image, LayoutGrid, Layers, ListChecks, Loader2,
  LogOut, Megaphone, Menu, Search, Settings, Shield, ShieldAlert, Users, BarChart3, Flag, Plug, X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  studioAudit, studioHealth, studioJobs, studioMedia, studioOverview, studioSaveSettings, studioSearch, studioUserAction, studioUsers,
} from "@/lib/studio.functions";
import { studioDeleteMedia } from "@/lib/upload.functions";
import type { UploadTargetT } from "@/lib/upload-keys";
import { Uploader } from "@/components/Uploader";
import { PostsPanel } from "@/components/StudioPosts";
import { DownloadButton } from "@/components/DownloadButton";

import { SECTIONS, type SectionId } from "@/lib/studio-sections";
import { MonetizationPanel } from "@/components/StudioMonetization";
import type { SiteSettingsT } from "@/lib/studio.functions";

export const Route = createFileRoute("/studio")({
  ssr: false,
  validateSearch: z.object({ s: z.enum(SECTIONS.map((s) => s.id) as [SectionId, ...SectionId[]]).catch("overview").default("overview") }),
  head: () => ({
    meta: [
      { title: "Studio — LoopgramChannel" },
      { name: "description", content: "LoopgramChannel owner control center." },
      { property: "og:title", content: "Studio — LoopgramChannel" },
      { property: "og:description", content: "LoopgramChannel owner control center." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioPage,
});

function errMsg(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^\d{3}:\s*/, "");
}

/** Calls an owner-only server function with a fresh ID token. */
function useTokenCall() {
  const { getToken } = useAuth();
  return async <T,>(fn: (a: { data: any }) => Promise<T>, extra: Record<string, unknown> = {}) => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return fn({ data: { token, ...extra } });
  };
}

function StudioPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const { s } = Route.useSearch();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (auth.ready && !auth.user) nav({ to: "/login", search: { redirect: "/studio" }, replace: true });
  }, [auth.ready, auth.user]);

  if (!auth.ready || (auth.user && !auth.role)) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Checking access" /></div>;
  if (!auth.user) return null;
  if (auth.role !== "owner") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-bold">Studio is for the owner only</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your account doesn't have access to this area.</p>
          <Link to="/" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Go to LoopgramChannel</Link>
        </div>
      </div>
    );
  }

  const current = SECTIONS.find((x) => x.id === s)!;
  const nav_ = (
    <nav aria-label="Studio" className="flex flex-col gap-0.5 p-2">
      {SECTIONS.map((x) => (
        <Link key={x.id} to="/studio" search={{ s: x.id }} onClick={() => setMobileOpen(false)} title={x.label}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent ${s === x.id ? "bg-accent font-semibold" : "text-muted-foreground"}`}>
          <x.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{x.label}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r md:flex ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          {!collapsed && <span className="font-black tracking-tight">LoopgramChannel <span className="text-muted-foreground">Studio</span></span>}
          <button onClick={() => setCollapsed((c) => !c)} className="ml-auto rounded p-1 hover:bg-accent" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{nav_}</div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-background/80" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r bg-background">
            <div className="flex h-14 items-center justify-between border-b px-3"><span className="font-black">Studio</span><button onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
            {nav_}
          </div>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0 text-sm"><span className="text-muted-foreground">Studio / </span><span className="font-semibold">{current.label}</span></div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">{auth.user.email}</span>
            <Link to="/" className="rounded-lg border px-3 py-1.5 text-xs hover:bg-accent">View site</Link>
            <button onClick={async () => { await auth.signOut(); nav({ to: "/login", replace: true }); }} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs hover:bg-accent"><LogOut className="h-3.5 w-3.5" />Sign out</button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <h1 className="mb-5 text-2xl font-black tracking-tight">{current.label}</h1>
          {s === "overview" && <Overview />}
          {s === "users" && <UsersPanel />}
          {s === "posts" && <PostsPanel />}
          {s === "media" && <MediaPanel />}
          {s === "search" && <SearchPanel />}
          {s === "announcements" && <SettingsPanel />}
          {s === "monetization" && <MonetizationPanel />}
          {s === "jobs" && <JobsPanel />}
          {s === "health" && <HealthPanel />}
          {s === "audit" && <AuditPanel />}
        </main>
      </div>
    </div>
  );
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border bg-card p-4"><h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>{children}</section>
);
const Stat = ({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) => (
  <div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-black">{value}</div>{note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}</div>
);
const Unavailable = () => <span className="text-base font-medium text-muted-foreground">Unavailable</span>;
const Skeleton = () => <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" />)}</div>;
const ErrorBox = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errMsg(error)} {retry && <button onClick={retry} className="ml-2 underline">Retry</button>}</div>
);

function Overview() {
  const call = useTokenCall();
  const q = useQuery({ queryKey: ["studio", "overview"], queryFn: () => call(studioOverview), staleTime: 30_000 });
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registered accounts" value={d.accounts ?? <Unavailable />} note="Firebase Authentication, all time" />
        <Stat label="Jobs waiting" value={d.queue ? d.queue.waiting : <Unavailable />} note="Amazon SQS (approximate)" />
        <Stat label="Failed jobs" value={d.queue ? d.queue.dead : <Unavailable />} note="Dead-letter list" />
        <Stat label="Announcement" value={d.settings.bannerOn ? "Live" : "Off"} note={d.settings.maintenance ? "Maintenance mode ON" : "Site open"} />
      </div>
      <Card title="Recent owner actions"><AuditTable entries={d.audit} /></Card>
    </div>
  );
}

function AuditTable({ entries }: { entries: any[] }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">No actions recorded yet.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Action</th><th className="pr-3">Target</th><th>Result</th></tr></thead>
      <tbody>{entries.map((e, i) => (
        <tr key={i} className="border-t"><td className="py-2 pr-3 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td><td className="pr-3">{e.email ?? e.uid}</td><td className="pr-3 font-mono text-xs">{e.action}</td><td className="pr-3 font-mono text-xs">{e.target}</td>
          <td><span className={`rounded px-1.5 py-0.5 text-xs ${e.outcome === "ok" ? "bg-secondary" : "bg-destructive/15 text-destructive"}`}>{e.outcome}</span></td></tr>
      ))}</tbody>
    </table></div>
  );
}

function UsersPanel() {
  const call = useTokenCall();
  const qc = useQueryClient();
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [lookup, setLookup] = useState("");
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState<{ uid: string; email: string | null; action: "disable" | "enable" | "revoke" } | null>(null);
  const pageToken = pages[pages.length - 1];
  const q = useQuery({ queryKey: ["studio", "users", pageToken, email], queryFn: () => call(studioUsers, { pageToken, email: email || undefined }) });
  const act = useMutation({
    mutationFn: (v: { uid: string; action: "disable" | "enable" | "revoke" }) => call(studioUserAction, v),
    onSuccess: () => { toast.success("Done"); setConfirm(null); qc.invalidateQueries({ queryKey: ["studio", "users"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPages([undefined]); setEmail(lookup.trim()); }}>
        <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Find by exact email" aria-label="Find user by email" className="h-10 flex-1 rounded-lg border bg-background px-3 text-sm" />
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Find</button>
        {email && <button type="button" onClick={() => { setLookup(""); setEmail(""); }} className="h-10 rounded-lg border px-3 text-sm">Clear</button>}
      </form>
      {q.isPending ? <Skeleton /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <>
          <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground"><tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Joined</th><th className="p-3">Last sign-in</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody>
              {q.data.users.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No accounts found.</td></tr>}
              {q.data.users.map((u) => (
                <tr key={u.uid} className="border-t">
                  <td className="p-3">{u.email ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3"><span className={`rounded px-1.5 py-0.5 text-xs ${u.role === "owner" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{u.role}</span></td>
                  <td className="p-3">{u.disabled ? <span className="text-destructive">Disabled</span> : "Active"}</td>
                  <td className="p-3 whitespace-nowrap">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="p-3 whitespace-nowrap">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "—"}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {u.role !== "owner" && (
                      <button onClick={() => setConfirm({ uid: u.uid, email: u.email, action: u.disabled ? "enable" : "disable" })} className="mr-1 inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent">
                        {u.disabled ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}{u.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                    <button onClick={() => setConfirm({ uid: u.uid, email: u.email, action: "revoke" })} className="rounded border px-2 py-1 text-xs hover:bg-accent">Sign out everywhere</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!email && (
            <div className="flex justify-between">
              <button disabled={pages.length < 2} onClick={() => setPages((p) => p.slice(0, -1))} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
              <button disabled={!q.data.next} onClick={() => setPages((p) => [...p, q.data.next!])} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
      {confirm && (
        <Confirm title={confirm.action === "disable" ? "Disable this account?" : confirm.action === "enable" ? "Re-enable this account?" : "Sign this account out everywhere?"}
          body={`${confirm.email ?? confirm.uid}${confirm.action === "disable" ? " won't be able to sign in until re-enabled." : confirm.action === "revoke" ? " will need to sign in again on every device." : " will be able to sign in again."}`}
          busy={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate({ uid: confirm.uid, action: confirm.action })} />
      )}
    </div>
  );
}

function Confirm({ title, body, busy, onCancel, onConfirm }: { title: string; body: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
      <div className="w-full max-w-sm rounded-xl border bg-card p-5">
        <h2 id="cf-title" className="font-bold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border px-3 py-1.5 text-sm" autoFocus>Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Confirm</button>
        </div>
      </div>
    </div>
  );
}

function MediaPanel() {
  const call = useTokenCall();
  const qc = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([""]);
  const [filter, setFilter] = useState("");
  const [dest, setDest] = useState<"original-video" | "image">("original-video");
  const cursor = cursors[cursors.length - 1]!;
  const q = useQuery({ queryKey: ["studio", "media", cursor], queryFn: () => call(studioMedia, { cursor }) });
  const del = useMutation({
    mutationFn: (key: string) => call(studioDeleteMedia, { key }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["studio", "media"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const target: UploadTargetT = { kind: dest };
  const field = "h-10 rounded-lg border bg-background px-3 text-sm";
  return (
    <div className="space-y-4">
      <Card title="Upload to your media bucket">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">What is it?
            <select value={dest} onChange={(e) => setDest(e.target.value as typeof dest)} className={`${field} mt-1 w-full`}>
              <option value="original-video">Video for a post</option>
              <option value="image">Picture (poster, banner)</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <Uploader key={JSON.stringify(target)} target={target} label="Choose file" onDone={() => qc.invalidateQueries({ queryKey: ["studio", "media"] })} />
        </div>
      </Card>
      {q.isPending ? <Skeleton /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (<>
      <p className="text-sm text-muted-foreground">Files in your Cloudflare R2 bucket.</p>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this page by name" aria-label="Filter files" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" />
      {(() => {
        const shown = q.data.items.filter((i) => i.key.toLowerCase().includes(filter.toLowerCase()));
        const base = (q.data.publicUrl ?? "").replace(/\/$/, "");
        if (!shown.length) return <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No files.</p>;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((i) => {
              const url = base ? `${base}/${i.key}` : "";
              const isVid = /\.(mp4|mov|webm|m3u8)$/i.test(i.key), isImg = /\.(jpe?g|png|webp|gif|avif)$/i.test(i.key);
              return (
                <div key={i.key} className="overflow-hidden rounded-xl border bg-card">
                  <a href={url || undefined} target="_blank" rel="noreferrer" className="block aspect-video bg-secondary" title={i.key}>
                    {url && isImg ? <img src={url} alt="" loading="lazy" className="h-full w-full bg-black object-contain" />
                      : url && isVid ? <video src={`${url}#t=1`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full bg-black object-contain" />
                      : <div className="grid h-full place-items-center text-xs text-muted-foreground">File</div>}
                  </a>
                  <div className="flex items-center gap-2 p-2 text-[11px] text-muted-foreground">
                    <span className="flex-1">{fmtBytes(i.size)}</span>
                    {isVid && <DownloadButton fileKey={i.key} label="Save" />}
                    {i.key.startsWith("media/") && <button aria-label={`Delete ${i.key}`} disabled={del.isPending} onClick={() => { if (confirm("Delete this file? Anything using it will stop playing.")) del.mutate(i.key); }} className="rounded border px-2 py-0.5 hover:bg-accent">Delete</button>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
      <div className="flex justify-between">
        <button disabled={cursors.length < 2} onClick={() => setCursors((c) => c.slice(0, -1))} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
        <button disabled={!q.data.next} onClick={() => setCursors((c) => [...c, q.data.next!])} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
      </div>
      </>)}
    </div>
  );
}
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function SearchPanel() {
  const call = useTokenCall();
  const [last, setLast] = useState<unknown>(null);
  const m = useMutation({
    mutationFn: (kind: "reconcile" | "retry") => call(studioSearch, { kind }),
    onSuccess: (r) => { setLast(r.result); toast.success("Search update finished"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <Card title="Algolia search index">
        <p className="mb-3 text-sm text-muted-foreground">Public search keeps working while these run. "Sync" brings the index in line with your content table; "Retry" re-runs items that failed before.</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={m.isPending} onClick={() => m.mutate("reconcile")} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Sync index</button>
          <button disabled={m.isPending} onClick={() => m.mutate("retry")} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60">Retry failed items</button>
        </div>
        {last != null && <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-secondary p-3 text-xs">{JSON.stringify(last, null, 2)}</pre>}
      </Card>
    </div>
  );
}

function SettingsPanel() {
  const call = useTokenCall();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["studio", "overview"], queryFn: () => call(studioOverview) });
  const [form, setForm] = useState<SiteSettingsT | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (q.data && !form) setForm(q.data.settings); }, [q.data]);
  const m = useMutation({
    mutationFn: () => call(studioSaveSettings, { settings: form }),
    onSuccess: () => { toast.success("Saved. Visitors see it on their next page load."); setConfirm(false); qc.invalidateQueries({ queryKey: ["studio"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (q.isPending || !form) return q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <Skeleton />;
  const risky = form.maintenance !== q.data!.settings.maintenance;
  return (
    <div className="max-w-xl space-y-4">
      <Card title="Background work (runs about once a minute)">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoQueue} onChange={(e) => setForm({ ...form, autoQueue: e.target.checked })} /> Process waiting jobs (search updates, video conversions)</label>
      </Card>
      <Card title="Announcement banner">
        <label htmlFor="banner" className="text-sm font-medium">Message (max 200 characters, plain text)</label>
        <input id="banner" maxLength={200} value={form.banner} onChange={(e) => setForm({ ...form, banner: e.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm" />
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.bannerOn} onChange={(e) => setForm({ ...form, bannerOn: e.target.checked })} /> Show banner on every page</label>
        {form.bannerOn && form.banner && <div className="mt-3 rounded-lg bg-primary px-3 py-2 text-center text-sm text-primary-foreground">{form.banner}</div>}
      </Card>
      <Card title="Maintenance mode">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.maintenance} onChange={(e) => setForm({ ...form, maintenance: e.target.checked })} /> Show a "back soon" page to visitors</label>
        <p className="mt-2 text-xs text-muted-foreground">Sign-in and Studio always stay open so you can't lock yourself out.</p>
      </Card>
      <button onClick={() => (risky ? setConfirm(true) : m.mutate())} disabled={m.isPending} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</button>
      {confirm && <Confirm title={form.maintenance ? "Turn on maintenance mode?" : "Turn off maintenance mode?"} body={form.maintenance ? "Visitors will see a 'back soon' page instead of LoopgramChannel." : "LoopgramChannel will open to visitors again."} busy={m.isPending} onCancel={() => setConfirm(false)} onConfirm={() => m.mutate()} />}
    </div>
  );
}

function JobsPanel() {
  const call = useTokenCall();
  const q = useQuery({ queryKey: ["studio", "jobs"], queryFn: () => call(studioJobs, { process: false }) });
  const m = useMutation({ mutationFn: () => call(studioJobs, { process: true }), onSuccess: () => { toast.success("Processed one batch"); q.refetch(); }, onError: (e) => toast.error(errMsg(e)) });
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const s = q.data.stats;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Waiting" value={s ? s.waiting : <Unavailable />} note="Amazon SQS, approximate" />
        <Stat label="Running" value={s ? s.inFlight : <Unavailable />} note="Received, not finished" />
        <Stat label="Failed (dead-lettered)" value={s ? s.dead : <Unavailable />} note="After 5 tries" />
      </div>
      {!s && <p className="text-sm text-muted-foreground">The queue didn't answer. Your AWS key may still be missing SQS permissions.</p>}
      <button disabled={m.isPending} onClick={() => m.mutate()} className="inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm disabled:opacity-60">{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Process up to 10 jobs now</button>
      <p className="text-xs text-muted-foreground">Jobs are safe to re-run: each has a done-marker, so nothing is indexed twice.</p>
    </div>
  );
}

function HealthPanel() {
  const call = useTokenCall();
  const q = useQuery({ queryKey: ["studio", "health"], queryFn: () => call(studioHealth), staleTime: 15_000 });
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Checked {new Date(q.data.at).toLocaleTimeString()} — live test calls from the server</span><button onClick={() => q.refetch()} className="rounded border px-2 py-1">{q.isFetching ? "Checking…" : "Check again"}</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data.checks.map((c) => (
          <div key={c.name} className="flex items-start gap-3 rounded-xl border bg-card p-4">
            {c.status === "ok" ? <Activity className="mt-0.5 h-4 w-4" /> : c.status === "down" ? <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" /> : <Settings className="mt-0.5 h-4 w-4 text-muted-foreground" />}
            <div className="min-w-0">
              <div className="font-semibold">{c.name}</div>
              <div className={`text-sm ${c.status === "down" ? "text-destructive" : "text-muted-foreground"}`}>{c.status === "ok" ? `Working${c.ms != null ? ` · ${c.ms} ms` : ""}` : c.status === "down" ? "Not responding" : "Not configured"}</div>
              {c.note && <div className="mt-1 break-words text-xs text-muted-foreground">{c.note}</div>}
            </div>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Database className="h-3 w-3" />Cloudflare zone controls and CloudWatch dashboards aren't checked here yet.</p>
    </div>
  );
}

function AuditPanel() {
  const call = useTokenCall();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["studio", "audit", page], queryFn: () => call(studioAudit, { page }) });
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Written only by the server. Includes denied Studio attempts. Keeps the latest 5,000 entries.</p>
      <div className="rounded-xl border p-3"><AuditTable entries={q.data.entries} /></div>
      <div className="flex justify-between">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Newer</button>
        <button disabled={q.data.entries.length < 50} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Older</button>
      </div>
    </div>
  );
}
