// Shared post display: one player for uploads, direct files and platform links (YouTube, Vimeo, Twitch…).
import { attachSource } from "@/lib/hls-attach";
import { useEffect, useRef, useState } from "react";
import { Pin, Play } from "lucide-react";

export const fmtDuration = (s: number) => {
  if (!isFinite(s) || s <= 0) return "";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

// One captured frame per video, shared by every card on the page (feed, up next, Studio).
// `ratio` (width / height) is read from the file itself, like YouTube does on upload.
type Frame = { img: string; dur: number; ratio: number };
const frames = new Map<string, Promise<Frame | null>>();
let capturePaused = false;
let playing = 0;
/** The Shorts player pauses background frame measuring so only the visible video uses the decoder. */
export function setCapturePaused(v: boolean) { capturePaused = v; }
/** While any video is playing, background thumbnail decoding waits so playback keeps full frame rate. */
export function markPlaying(on: boolean) { playing = Math.max(0, playing + (on ? 1 : -1)); }
const busy = () => capturePaused || playing > 0;
const whenFree = () => new Promise<void>((r) => { const t = () => (busy() ? setTimeout(t, 1500) : r()); t(); });
export function captureFrame(url: string): Promise<Frame | null> {
  let p = frames.get(url);
  if (p) return p;
  p = whenFree().then(() => new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; v.muted = true; v.playsInline = true; v.preload = "metadata";
    let ratio = 0;
    const done = (r: Frame | null) => { clearTimeout(timer); v.removeAttribute("src"); v.load(); resolve(r); };
    const partial = () => done(ratio ? { img: "", dur: v.duration || 0, ratio } : null);
    const timer = setTimeout(partial, 15000);
    v.onloadedmetadata = () => {
      if (v.videoWidth && v.videoHeight) ratio = v.videoWidth / v.videoHeight;
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = () => {
      try {
        const w = Math.min(640, v.videoWidth || 640), h = Math.round(w * ((v.videoHeight || 9) / (v.videoWidth || 16)));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, w, h);
        done({ img: c.toDataURL("image/jpeg", 0.8), dur: v.duration, ratio: ratio || w / h });
      } catch { partial(); }
    };
    v.onerror = partial;
    v.src = url;
  }));
  frames.set(url, p);
  return p;
}

/** Shape of a post's video (width / height): Shorts links are 9:16, uploaded files are measured, the rest 16:9.
 *  `null` while an uploaded file is still being measured. */
export function postRatio(url: string): number | null | Promise<number> {
  if (!url) return 16 / 9;
  const s = parseVideoSource(url);
  if (s.embed) return s.provider === "youtube" && /\/shorts\//i.test(url) ? 9 / 16 : 16 / 9;
  return captureFrame(url).then((r) => r?.ratio || 16 / 9);
}
export const isShort = (ratio: number | null | undefined) => !!ratio && ratio < 0.9;
/** A post is a Short when its video is vertical: saved shape from Studio first, else the measured one. */
export const postIsShort = (p: { videoUrl: string; ratio?: number }, ratios: Record<string, number>) =>
  !!p.videoUrl && isShort(p.ratio || ratios[p.videoUrl]);

/** Measures every post's video shape (for splitting Shorts from regular videos, like YouTube). */
export function useRatios(urls: string[]): Record<string, number> {
  const [m, setM] = useState<Record<string, number>>({});
  const key = urls.join("|");
  useEffect(() => {
    let live = true;
    // Speed: never download video files just to measure shape. Uploaded files without a
    // saved Studio ratio are measured later, one at a time, only when the browser is idle.
    const pending: string[] = [];
    for (const u of urls) {
      if (!u) continue;
      const s = parseVideoSource(u);
      if (s.embed) { const r = postRatio(u) as number; setM((o) => (o[u] === r ? o : { ...o, [u]: r })); }
      else pending.push(u);
    }
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? (window as any).requestIdleCallback(cb, { timeout: 8000 }) : setTimeout(cb, 4000));
    const next = () => {
      if (!live) return;
      // Watching Shorts: don't fight the playing video for the phone's decoder/network.
      if (capturePaused) { setTimeout(() => idle(next), 3000); return; }
      const u = pending.shift();
      if (!u) return;
      captureFrame(u).then((x) => { if (live && x?.ratio) setM((o) => ({ ...o, [u]: x.ratio })); idle(next); });
    };
    if (pending.length) idle(next);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}

/** Real picture from an uploaded video file (like YouTube's auto thumbnail) + its length. */
function FrameThumb({ url, title, className }: { url: string; title: string; className: string }) {
  const [r, setR] = useState<Frame | null | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const el = ref.current;
    const go = () => captureFrame(url).then((x) => live && setR(x && x.img ? x : null));
    if (!el || !("IntersectionObserver" in window)) { go(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: "300px" });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [url]);
  return (
    <div ref={ref} className={`relative overflow-hidden bg-black ${className}`}>
      {r ? <>
        <img src={r.img} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl" />
        <img src={r.img} alt="" className="relative h-full w-full object-contain" />
        {fmtDuration(r.dur) && <span className="absolute bottom-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold">{fmtDuration(r.dur)}</span>}
      </> : (
        <div className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary to-background p-3 text-center ${r === undefined ? "animate-pulse" : ""}`}>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"><Play className="h-5 w-5 fill-current" /></span>
          <span className="line-clamp-2 text-xs font-semibold">{title}</span>
        </div>
      )}
    </div>
  );
}
import type { PostT } from "@/lib/posts";
import { parseVideoSource } from "@/lib/video-source";

function useHost() {
  const [h, setH] = useState("localhost");
  useEffect(() => setH(window.location.hostname), []);
  return h;
}

export function SourceBadge({ url, className = "" }: { url: string; className?: string }) {
  if (!url) return null;
  const s = parseVideoSource(url);
  const label = s.provider === "file" ? "HD Video" : s.provider === "unknown" ? "Loopgram" : s.label;
  return <span className={`rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary ${className}`}>{label}</span>;
}

/** True when a player message reports that the video can't play in the embed. */
function isEmbedError(data: unknown): boolean {
  let d: unknown = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return /error|forbidden|restricted/i.test(d as string); } }
  if (!d || typeof d !== "object") return false;
  const o = d as { event?: unknown; method?: unknown };
  if (o.event === "error" || o.event === "onError" || o.method === "error") return true; // Vimeo / YouTube
  if (typeof o.event === "string" && /error/i.test(o.event)) return true; // Dailymotion & others
  return false;
}

export function PostVideo({ url, poster }: { url: string; poster?: string }) {
  const parent = useHost();
  const src = parseVideoSource(url, { parent });
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  useEffect(() => {
    if (!src.embed) return;
    let origin = "";
    try { origin = new URL(src.embed).origin; } catch { return; }
    const onMsg = (e: MessageEvent) => { if (e.origin === origin && isEmbedError(e.data)) setFailed(true); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [src.embed]);
  if (src.embed) {
    // X posts are tall cards; YouTube Shorts are vertical (9:16) like on YouTube; everything else 16:9.
    const vertical = src.provider === "youtube" && /\/shorts\//i.test(url);
    const box = src.provider === "twitter" ? "h-[620px] w-full" : vertical ? "aspect-[9/16] mx-auto max-h-[80vh] w-auto max-w-full" : "aspect-video w-full";
    if (failed) {
      const pic = poster || src.thumb;
      return (
        <div className="relative grid aspect-video w-full place-items-center overflow-hidden bg-black sm:rounded-xl">
          {pic && <img src={pic} alt="" className="absolute inset-0 h-full w-full object-contain opacity-30" />}
          <div className="relative flex flex-col items-center gap-3 p-4 text-center">
            <p className="text-sm font-semibold text-primary-foreground">This video can't play here</p>
            <div className="flex flex-wrap justify-center gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Watch on {src.label} ↗</a>
              <button onClick={() => setFailed(false)} className="rounded-full bg-secondary px-4 py-2 text-sm font-medium">Try again</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="w-full bg-black sm:rounded-xl">
        <div className={`overflow-hidden ${box}`} style={vertical ? { height: "calc(100dvh - 3.5rem)", maxHeight: "none" } : undefined}>
          <iframe src={src.embed} title={src.label} className="block h-full w-full border-0" allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      </div>
    );
  }
  return <NativePlayer url={url} poster={poster} />;
}

/** Native file, YouTube-style: the box takes the recording's real shape (never taller than 80% of the screen),
 *  the picture is always shown whole with black bars, with a big play button, a loading ring and a preview frame. */
function NativePlayer({ url, poster }: { url: string; poster?: string | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);
  const playingRef = useRef(false);
  useEffect(() => () => { if (playingRef.current) { playingRef.current = false; markPlaying(false); } }, []);
  const [ratio, setRatio] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [frame, setFrame] = useState<string | undefined>(poster || undefined);
  const [error, setError] = useState(false);
  useEffect(() => {
    setStarted(false); setError(false); setRatio(null); setFrame(poster || undefined);
    if (!poster) captureFrame(url).then((r) => { if (r) setFrame(r.img); });
  }, [url, poster]);
  useEffect(() => { const v = ref.current; if (!v) return; return attachSource(v, url); }, [url]);
  const r = ratio ?? 16 / 9;
  const portrait = r < 1;
  const play = () => { const v = ref.current; if (!v) return; setStarted(true); setBuffering(true); v.play().catch(() => setBuffering(false)); };
  // Portrait (9:16 etc.): the player fills the full width and runs down to the bottom of the screen like YouTube Shorts;
  // the whole picture stays visible (object-contain) with a blurred copy filling the sides. Landscape: full width, own ratio.
  const boxStyle = portrait
    ? { height: `min(calc(100vw / ${r}), calc(100dvh - 3.5rem))` }
    : { aspectRatio: String(r), maxHeight: "80vh", maxWidth: `min(100%, calc(80vh * ${r}))` };
  return (
    <div className="relative flex w-full justify-center overflow-hidden bg-black sm:rounded-xl">
      <div className="relative w-full" style={{ ...boxStyle, transform: "translateZ(0)" }}>
        <video ref={ref} poster={frame} crossOrigin="anonymous" controls={started} playsInline preload="metadata" className="absolute inset-0 block h-full w-full object-contain"
          onLoadedMetadata={(e) => { const v = e.currentTarget; v.playbackRate = 1; v.defaultPlaybackRate = 1; if (v.videoWidth && v.videoHeight) setRatio(Math.min(4, Math.max(0.25, v.videoWidth / v.videoHeight))); }}
          onPlay={() => { setStarted(true); if (!playingRef.current) { playingRef.current = true; markPlaying(true); } }}
          onPause={() => { if (playingRef.current) { playingRef.current = false; markPlaying(false); } }}
          onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)}
          onError={() => { setError(true); setBuffering(false); }} />
        {!started && !error && (
          <button onClick={play} aria-label="Play video" className="group absolute inset-0 grid place-items-center bg-gradient-to-t from-background/60 via-transparent to-transparent">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-110 sm:h-20 sm:w-20">
              <Play className="ml-1 h-8 w-8 fill-current sm:h-10 sm:w-10" />
            </span>
          </button>
        )}
        {started && buffering && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-muted-foreground/40 border-t-primary" aria-label="Loading video" /></div>}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-background/85 p-4 text-center text-sm">
            <div><p className="font-semibold">This video couldn't load.</p>
              <button onClick={() => { setError(false); ref.current?.load(); }} className="mt-3 rounded-full bg-primary px-4 py-1.5 text-primary-foreground">Try again</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Picture for a post: its image, else the platform thumbnail or a frame from its video, else the title.
 *  Like YouTube, any shape fits whole inside the card (black bars), never cropped. */
export function PostThumb({ post, className = "", fill = false }: { post: Pick<PostT, "imageUrl" | "videoUrl" | "title" | "text">; className?: string; fill?: boolean }) {
  void fill; // every shape is shown whole (never cropped), like YouTube
  if (post.imageUrl) return <img src={post.imageUrl} alt="" loading="lazy" className={`bg-black object-contain ${className}`} />;
  if (post.videoUrl) {
    const s = parseVideoSource(post.videoUrl);
    if (s.thumb) return <img src={s.thumb} alt="" loading="lazy" className={`bg-black object-contain ${className}`} />;
    if (!s.embed) return <FrameThumb url={post.videoUrl} title={post.title || post.text.slice(0, 60) || "Video"} className={className} />;
  }
  return <div className={`grid place-items-center bg-secondary p-2 text-center text-xs font-semibold ${className}`}>{post.title || post.text.slice(0, 60) || "Video"}</div>;
}

export function PostCard({ post }: { post: PostT }) {
  return (
    <article id={post.id} className="-mx-4 scroll-mt-20 border-b pb-4 sm:mx-0 sm:rounded-2xl sm:border sm:bg-card sm:p-4 [&>*:not(.post-media)]:px-4 sm:[&>*:not(.post-media)]:px-0">
      {post.videoUrl ? <div className="post-media mb-3"><PostVideo url={post.videoUrl} poster={post.imageUrl} /></div>
        : post.imageUrl ? <img src={post.imageUrl} alt={post.title} loading="lazy" className="post-media mb-3 w-full object-contain sm:rounded-xl" /> : null}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {post.pinned && <span className="inline-flex items-center gap-1 text-primary"><Pin className="h-3 w-3" />Pinned</span>}
        {post.category && <span className="rounded-full bg-secondary px-2 py-0.5">{post.category}</span>}
        <SourceBadge url={post.videoUrl} />
        <time dateTime={new Date(post.createdAt).toISOString()}>{new Date(post.createdAt).toLocaleDateString()}</time>
      </div>
      {post.title && <h2 className="mb-1 text-lg font-bold">{post.title}</h2>}
      {post.text && <p className="whitespace-pre-line text-sm">{post.text}</p>}
    </article>
  );
}
