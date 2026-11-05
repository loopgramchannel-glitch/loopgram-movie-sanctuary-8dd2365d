// Studio: write, upload and manage posts. Shown as picture cards; tap one to preview and edit.
import { ThumbPicker } from "@/components/ThumbPicker";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pin, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { studioPostDelete, studioPostSave, studioPosts } from "@/lib/posts.functions";
import { Post, type PostT } from "@/lib/posts";
import { Uploader } from "@/components/Uploader";
import { PostThumb, PostVideo, postIsShort, useRatios } from "@/components/PostView";
import { VideoInspector } from "@/components/VideoInspector";
import { DownloadButton, keyFromUrl } from "@/components/DownloadButton";
import { parseVideoSource, POST_CATEGORIES } from "@/lib/video-source";
import { linkTitle } from "@/lib/link-title.functions";
import { timeAgo } from "@/lib/posts-query";

const btn = "inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-accent disabled:opacity-50";
const primary = "inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50";
const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");
const newId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function PostsPanel() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const call = async <T,>(fn: (a: { data: any }) => Promise<T>, extra: Record<string, unknown> = {}) => {
    const token = await getToken(); if (!token) throw new Error("Not signed in");
    return fn({ data: { token, ...extra } });
  };
  const q = useQuery({ queryKey: ["studio", "posts"], queryFn: () => call(studioPosts) });
  const [edit, setEdit] = useState<PostT | null>(null);
  const [tab, setTab] = useState<"All" | "Videos" | "Shorts">("All");
  const done = () => { qc.invalidateQueries({ queryKey: ["studio", "posts"] }); qc.invalidateQueries({ queryKey: ["posts"] }); };
  const save = useMutation({ mutationFn: (p: PostT) => call(studioPostSave, { post: p }), onSuccess: () => { toast.success("Posted. Visitors see it now."); setEdit(null); done(); }, onError: (e) => toast.error(err(e)) });
  const del = useMutation({ mutationFn: (id: string) => call(studioPostDelete, { id }), onSuccess: () => { toast.success("Deleted"); setEdit(null); done(); }, onError: (e) => toast.error(err(e)) });

  const list = q.data ?? [];
  const ratios = useRatios(list.map((p) => p.videoUrl));
  const live = list.filter((p) => p.published).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[["All posts", list.length], ["Live", live], ["Drafts", list.length - live]].map(([l, n]) => (
          <div key={l} className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-black">{n}</div></div>
        ))}
      </div>
      <button className={primary} onClick={() => setEdit(Post.parse({ id: newId(), createdAt: Date.now() }))}><Plus className="h-4 w-4" />New post</button>
      <div className="scrollbar-none flex gap-2 overflow-x-auto">
        {(["All", "Videos", "Shorts"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-foreground text-background" : "bg-secondary hover:bg-accent"}`}>{t}</button>
        ))}
      </div>
      {q.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : q.isError ? <p className="text-sm text-destructive">{err(q.error)}</p>
        : list.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No posts yet. Tap “New post”.</p> : (() => {
          const shorts = list.filter((p) => postIsShort(p, ratios));
          const videos = list.filter((p) => !postIsShort(p, ratios));
          const badges = (p: PostT) => (
            <div className="absolute left-1.5 top-1.5 flex gap-1">
              {p.pinned && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"><Pin className="inline h-3 w-3" /></span>}
              {!p.published && <span className="rounded bg-background/90 px-1.5 py-0.5 text-[10px]">Draft</span>}
            </div>
          );
          const videoGrid = (l: PostT[]) => l.length === 0 ? <p className="text-sm text-muted-foreground">No videos yet.</p> : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {l.map((p) => (
                <button key={p.id} onClick={() => setEdit(p)} className="text-left">
                  <div className="relative overflow-hidden rounded-xl"><PostThumb post={p} className="aspect-video w-full" />{badges(p)}</div>
                  <h3 className="mt-2 line-clamp-2 text-sm font-semibold">{p.title || p.text.slice(0, 90) || "Untitled"}</h3>
                  <p className="text-xs text-muted-foreground">{p.category ? `${p.category} · ` : ""}{timeAgo(p.createdAt)}</p>
                </button>
              ))}
            </div>
          );
          const shortGrid = (l: PostT[]) => l.length === 0 ? <p className="text-sm text-muted-foreground">No Shorts yet.</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {l.map((p) => (
                <button key={p.id} onClick={() => setEdit(p)} className="relative overflow-hidden rounded-xl bg-black text-left">
                  <PostThumb post={p} className="aspect-[9/16] w-full" />{badges(p)}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2"><h3 className="line-clamp-2 text-xs font-semibold text-white">{p.title || "Untitled"}</h3></div>
                </button>
              ))}
            </div>
          );
          return tab === "Videos" ? videoGrid(videos) : tab === "Shorts" ? shortGrid(shorts) : (
            <div className="space-y-5">
              <section><h3 className="mb-2 font-bold">Videos ({videos.length})</h3>{videoGrid(videos)}</section>
              <section><h3 className="mb-2 font-bold">Shorts ({shorts.length})</h3>{shortGrid(shorts)}</section>
            </div>
          );
        })()}
      {edit && <Editor value={edit} busy={save.isPending || del.isPending} onClose={() => setEdit(null)} onSave={(p) => save.mutate(p)}
        onDelete={list.some((x) => x.id === edit.id) ? () => { if (confirm("Delete this post?")) del.mutate(edit.id); } : undefined} />}
    </div>
  );
}

function Editor({ value, busy, onClose, onSave, onDelete }: { value: PostT; busy: boolean; onClose: () => void; onSave: (p: PostT) => void; onDelete?: (() => void) | undefined }) {
  const [v, setV] = useState(value);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [autoThumb, setAutoThumb] = useState(!value.imageUrl);
  const set = <K extends keyof PostT>(k: K, x: PostT[K]) => setV((o) => ({ ...o, [k]: x }));
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-3 sm:p-6" role="dialog" aria-label="Edit post">
      <div className="mx-auto max-w-2xl space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between"><h2 className="font-bold">{onDelete ? "Edit post" : "New post"}</h2><button aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></button></div>
        {v.videoUrl && !parseVideoSource(v.videoUrl).embed && <VideoInspector url={v.videoUrl} onInfo={(i) => { if (i?.width && i.height) setV((o) => ({ ...o, ratio: Math.round((i.width / i.height) * 1000) / 1000 })); }} />}
        {v.videoUrl ? <PostVideo url={v.videoUrl} poster={v.imageUrl} /> : v.imageUrl ? <img src={v.imageUrl} alt="" className="w-full rounded-xl object-contain" /> : null}
        <div className="flex flex-wrap gap-2">
          <Uploader compact target={{ kind: "original-video" }} label={v.videoUrl ? "Replace video" : "Add video"} onDone={(r) => {
            const name = (r.fileName ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
            // Phone/camera default names (VID_2026…, IMG_1234, 8-digit numbers) aren't real titles.
            const usable = name && !/^(vid|img|mov|pxl|video)?\s*\d[\d\s]*$/i.test(name) && /[a-z]{3}/i.test(name);
            setFile(r.file); if (!v.imageUrl) setAutoThumb(true);
            setV((o) => ({ ...o, videoUrl: r.publicUrl, ratio: 0, title: o.title.trim() || !usable ? o.title : name.charAt(0).toUpperCase() + name.slice(1) }));
          }} />
          <Uploader compact target={{ kind: "image" }} label={v.imageUrl ? "Replace picture" : "Add picture / thumbnail"} onDone={(r) => set("imageUrl", r.publicUrl)} />
          {v.videoUrl && !parseVideoSource(v.videoUrl).embed && <DownloadButton fileKey={keyFromUrl(v.videoUrl)} label="Download video" className={btn} />}
          {v.videoUrl && <button className={btn} onClick={() => setV((o) => ({ ...o, videoUrl: "", ratio: 0 }))}>Remove video</button>}
          {v.imageUrl && <button className={btn} onClick={() => set("imageUrl", "")}>Remove picture</button>}
        </div>
        {v.videoUrl && !parseVideoSource(v.videoUrl).embed && <ThumbPicker file={file} videoUrl={v.videoUrl} current={v.imageUrl} auto={autoThumb && !v.imageUrl} onPick={(u) => { setAutoThumb(false); set("imageUrl", u); }} />}
        <LinkBox onUse={(u) => {
          setV((o) => ({ ...o, videoUrl: u, ratio: /\/shorts\//i.test(u) ? 0.5625 : 0 }));
          linkTitle({ data: { url: u } }).then((r) => { if (r.title) setV((o) => (o.title.trim() ? o : { ...o, title: r.title })); }).catch(() => {});
        }} />
        <input value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Title (optional)" className={field} />
        <textarea value={v.text} onChange={(e) => set("text", e.target.value)} maxLength={5000} rows={4} placeholder="Write something…" className={field} />
        <div className="flex flex-wrap gap-1.5">
          {POST_CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => set("category", v.category === c ? "" : c)}
              className={`rounded-full border px-3 py-1 text-xs ${v.category === c ? "bg-primary text-primary-foreground" : ""}`}>{c}</button>
          ))}
        </div>
        <input value={v.category} onChange={(e) => set("category", e.target.value)} maxLength={40} placeholder="Or type your own category" className={field} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.pinned} onChange={(e) => set("pinned", e.target.checked)} />Pin to the top</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.published} onChange={(e) => set("published", e.target.checked)} />Show on the website</label>
        <div className="flex flex-wrap gap-2 pt-2">
          <button className={primary} disabled={busy} onClick={() => onSave(v)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{v.published ? "Post" : "Save draft"}</button>
          <button className={btn} onClick={onClose}>Cancel</button>
          {onDelete && <button className={`${btn} ml-auto text-destructive`} disabled={busy} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" />Delete</button>}
        </div>
      </div>
    </div>
  );
}

/** Paste a link from YouTube, Vimeo, Twitch… — shows which platform it is before you use it. */
function LinkBox({ onUse }: { onUse: (url: string) => void }) {
  const [u, setU] = useState("");
  const s = u.trim() ? parseVideoSource(u) : null;
  const ok = s && s.provider !== "unknown";
  return (
    <div className="space-y-1.5 rounded-xl border p-2">
      <div className="text-xs font-semibold">Or paste a video link</div>
      <div className="flex gap-2">
        <input value={u} onChange={(e) => setU(e.target.value)} placeholder="https://youtube.com/… · vimeo · twitch · dailymotion · .mp4" className={field} />
        <button className={primary} disabled={!ok} onClick={() => { onUse(u.trim()); setU(""); }}>Use</button>
      </div>
      {s && <div className={`text-xs ${ok ? "text-primary" : "text-destructive"}`}>{ok ? `Detected: ${s.label}` : "Not a supported video link"}</div>}
    </div>
  );
}
