// YouTube-style thumbnails: grabs 3 frames from the video (local file when just uploaded, so it's instant),
// auto-saves the middle one as the post picture, and lets the owner tap another frame to switch.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { uploadBlob } from "@/components/Uploader";

type Shot = { url: string; blob: Blob };

export function grabFrames(src: string, cross: boolean, at = [0.1, 0.5, 0.9]): Promise<Shot[]> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    if (cross) v.crossOrigin = "anonymous";
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const out: Shot[] = [];
    let i = 0, times: number[] = [];
    const finish = () => { clearTimeout(t); v.removeAttribute("src"); v.load(); resolve(out); };
    const t = setTimeout(finish, 20000);
    v.onloadedmetadata = () => { const d = v.duration || 1; times = at.map((f) => Math.max(0.05, Math.min(d - 0.05, d * f))); v.currentTime = times[0]!; };
    v.onseeked = () => {
      const w = Math.min(1280, v.videoWidth || 1280), h = Math.round(w * ((v.videoHeight || 9) / (v.videoWidth || 16)));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      try { c.getContext("2d")!.drawImage(v, 0, 0, w, h); } catch { finish(); return; }
      c.toBlob((b) => {
        if (b) out.push({ blob: b, url: URL.createObjectURL(b) });
        i++; if (i < times.length) v.currentTime = times[i]!; else finish();
      }, "image/jpeg", 0.85);
    };
    v.onerror = finish;
    v.src = src;
  });
}

export function ThumbPicker({ file, videoUrl, current, auto, onPick }: { file?: File | undefined; videoUrl: string; current: string; auto: boolean; onPick: (url: string) => void }) {
  const { getToken } = useAuth();
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);

  const save = async (s: Shot, idx: number, quiet = false) => {
    const token = await getToken(); if (!token) return;
    setBusy(idx);
    try { onPick(await uploadBlob(token, { kind: "image" }, s.blob, "image/jpeg")); setChosen(idx); if (!quiet) toast.success("Thumbnail set"); }
    catch { toast.error("Couldn't save the thumbnail"); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    let live = true;
    const local = file ? URL.createObjectURL(file) : null;
    setShots(null); setChosen(null);
    grabFrames(local ?? videoUrl, !local).then((s) => {
      if (!live) return;
      setShots(s);
      const pick = s[1] ?? s[0];
      if (auto && pick) void save(pick, s[1] ? 1 : 0, true);
    });
    return () => { live = false; if (local) URL.revokeObjectURL(local); };
  }, [file, videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-1.5 rounded-xl border p-2">
      <div className="text-xs font-semibold">Thumbnail {current ? "· tap a frame to change" : "· picking one…"}</div>
      {!shots ? <div className="flex h-16 items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Making thumbnails…</div>
        : shots.length === 0 ? <p className="text-xs text-muted-foreground">Couldn't read frames from this video. Add a picture instead.</p>
        : <div className="grid grid-cols-3 gap-2">{shots.map((s, i) => (
          <button key={s.url} type="button" disabled={busy !== null} onClick={() => save(s, i)}
            className={`relative aspect-video overflow-hidden rounded-lg border-2 bg-muted ${chosen === i ? "border-primary" : "border-transparent"}`}>
            <img src={s.url} alt={`Frame ${i + 1}`} className="h-full w-full object-contain" />
            {busy === i && <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="h-4 w-4 animate-spin" /></span>}
            {chosen === i && busy !== i && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}
          </button>))}</div>}
    </div>
  );
}
