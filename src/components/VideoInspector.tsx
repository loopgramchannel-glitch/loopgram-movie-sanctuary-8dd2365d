// Shows a video's real size (pixels, shape, length) before the owner posts it.
import { useEffect, useState } from "react";
import { Loader2, MonitorPlay, Smartphone, Square } from "lucide-react";

export type VideoInfo = { width: number; height: number; duration: number };

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

export function describeShape(w: number, h: number) {
  const r = w / h;
  if (r < 0.95) return { label: "Vertical (phone)", ratio: r > 0.7 ? "3:4" : "9:16", fit: "Fills the phone screen tall, like a Short. Wide screens show it centered.", kind: "tall" as const };
  if (r <= 1.05) return { label: "Square", ratio: "1:1", fit: "Shown as a square, centered, nothing cut off.", kind: "square" as const };
  const g = gcd(w, h);
  const exact = `${w / g}:${h / g}`;
  return { label: "Widescreen", ratio: Math.abs(r - 16 / 9) < 0.03 ? "16:9" : exact.length <= 7 ? exact : r.toFixed(2) + ":1", fit: "Plays as a standard 16:9 widescreen video.", kind: "wide" as const };
}

const fmtTime = (s: number) => !isFinite(s) ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const quality = (w: number, h: number) => { const p = Math.min(w, h); return p >= 2160 ? "4K" : p >= 1440 ? "2K" : p >= 1080 ? "Full HD" : p >= 720 ? "HD" : "Low quality"; };

export function VideoInspector({ url, onInfo }: { url: string; onInfo?: (i: VideoInfo | null) => void }) {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setInfo(null); setFailed(false);
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.src = url;
    v.onloadedmetadata = () => { const i = { width: v.videoWidth, height: v.videoHeight, duration: v.duration }; setInfo(i); onInfo?.(i); };
    v.onerror = () => { setFailed(true); onInfo?.(null); };
    return () => { v.removeAttribute("src"); v.load(); };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive">Couldn't read this video's size.</div>;
  if (!info) return <div className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking video size…</div>;
  const s = describeShape(info.width, info.height);
  const Icon = s.kind === "tall" ? Smartphone : s.kind === "square" ? Square : MonitorPlay;
  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-2 font-semibold"><Icon className="h-5 w-5 text-primary" />Video size</div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat l="Size" v={`${info.width} × ${info.height}`} />
        <Stat l="Shape" v={`${s.ratio} ${s.label}`} />
        <Stat l="Quality" v={quality(info.width, info.height)} />
        <Stat l="Length" v={fmtTime(info.duration)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{s.fit}</p>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return <div className="rounded-lg bg-background p-2"><div className="text-[10px] uppercase text-muted-foreground">{l}</div><div className="font-bold">{v}</div></div>;
}
