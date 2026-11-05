// YouTube-Shorts style pieces: vertical 9:16 cards and the full-screen vertical player.
import { attachSource } from "@/lib/hls-attach";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdSlot, useAdsAllowed } from "@/components/AdSlot";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, ChevronDown, ChevronUp, Home, Pause, Play, Share2, ThumbsDown, ThumbsUp, Volume2, VolumeX, X } from "lucide-react";
import type { PostT } from "@/lib/posts";
import { PostThumb, setCapturePaused, withAutoplay } from "@/components/PostView";
import { parseVideoSource } from "@/lib/video-source";
import { formatCount, viewsLabel } from "@/lib/post-stats";
import { usePostEngagement } from "@/lib/use-post-stats";

export function ShortsMark({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground ${className}`}><Play className="h-2.5 w-2.5 fill-current" />Shorts</span>;
}

export function ShortTile({ post, className = "w-40 sm:w-48" }: { post: PostT; className?: string }) {
  const title = post.title || post.text.slice(0, 80) || "Short";
  return (
    <Link to="/post/$id" params={{ id: post.id }} className={`group relative block shrink-0 overflow-hidden rounded-xl bg-black ${className}`}>
      <PostThumb post={post} fill className="aspect-[9/16] w-full transition-transform group-hover:scale-[1.03]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-10">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{title}</h3>
      </div>
    </Link>
  );
}

export function ShortsShelf({ posts }: { posts: PostT[] }) {
  if (!posts.length) return null;
  return (
    <section className="py-3">
      <h2 className="flex items-center gap-2 px-4 text-lg font-bold"><ShortsMark />Shorts</h2>
      <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {posts.map((p) => <ShortTile key={p.id} post={p} />)}
      </div>
    </section>
  );
}

/** YouTube/TikTok-style feed: native CSS scroll-snap (runs on the GPU, never freezes), one playing video,
 *  the next one quietly pre-buffered, everything else a still picture. URL synced without reload. */
type Slide = PostT | { ad: string };
const isAd = (x: Slide): x is { ad: string } => "ad" in x;

export function ShortsPlayer({ shorts: posts, startId, onShare }: { shorts: PostT[]; startId: string; onShare: (p: PostT) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const start = Math.max(0, posts.findIndex((p) => p.id === startId));
  const adsOn = useAdsAllowed("shorts");
  const { settings } = useAuth();
  const every = Math.max(3, settings?.adFeedEvery ?? 5);
  // Ad slides only go after the opened Short, so the starting position never shifts when ads switch on.
  const shorts = useMemo<Slide[]>(() => {
    if (!adsOn) return posts;
    const out: Slide[] = [];
    posts.forEach((p, i) => { out.push(p); if (i >= start && (i - start + 1) % every === 0 && i < posts.length - 1) out.push({ ad: `ad-${i}` }); });
    return out;
  }, [posts, adsOn, every, start]);
  const [active, setActive] = useState(start);
  const [muted, setMuted] = useState(false);
  const navigate = useNavigate();
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    setCapturePaused(true); // stop background thumbnail work while watching
    return () => { document.body.style.overflow = ""; setCapturePaused(false); };
  }, []);
  // Jump to the opened Short instantly on first paint.
  useEffect(() => {
    const el = box.current; if (!el) return;
    el.scrollTop = activeRef.current * el.clientHeight;
  }, []);
  // Keep the address bar on the visible Short, but only after the swipe settles.
  useEffect(() => {
    const t = setTimeout(() => {
      const p = shorts[active];
      if (p && !isAd(p) && location.pathname !== `/post/${p.id}`) history.replaceState(history.state, "", `/post/${p.id}`);
    }, 400);
    return () => clearTimeout(t);
  }, [active, shorts]);
  // Which Short is on screen: read from the native scroll position (cheap, passive, rAF-throttled).
  useEffect(() => {
    const el = box.current; if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
        if (i !== activeRef.current && i >= 0 && i < shorts.length) setActive(i);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [shorts.length]);

  const goTo = (i: number) => {
    const el = box.current; if (!el) return;
    const n = Math.min(shorts.length - 1, Math.max(0, i));
    el.scrollTo({ top: n * el.clientHeight, behavior: "smooth" });
  };
  // Mouse drag (computers): touch phones already scroll natively; this adds click-and-drag swiping.
  useEffect(() => {
    const el = box.current; if (!el) return;
    let y0 = 0, down = false, moved = false;
    const pd = (e: PointerEvent) => { if (e.pointerType !== "mouse" || e.button !== 0) return; down = true; moved = false; y0 = e.clientY; };
    const pm = (e: PointerEvent) => { if (down && Math.abs(e.clientY - y0) > 8) moved = true; };
    const pu = (e: PointerEvent) => {
      if (!down) return; down = false;
      const dy = e.clientY - y0;
      if (moved && Math.abs(dy) > 40) goTo(activeRef.current + (dy < 0 ? 1 : -1));
    };
    const click = (e: MouseEvent) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    el.addEventListener("pointerdown", pd); window.addEventListener("pointermove", pm); window.addEventListener("pointerup", pu);
    el.addEventListener("click", click, true);
    return () => { el.removeEventListener("pointerdown", pd); window.removeEventListener("pointermove", pm); window.removeEventListener("pointerup", pu); el.removeEventListener("click", click, true); };
  }, [shorts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowDown") { e.preventDefault(); goTo(activeRef.current + 1); } if (e.key === "ArrowUp") { e.preventDefault(); goTo(activeRef.current - 1); } if (e.key === "Escape") navigate({ to: "/" }); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <div ref={box} className="scrollbar-none h-dvh snap-y snap-mandatory overflow-y-scroll overscroll-contain">
        {shorts.map((p, i) => isAd(p) ? (
          <div key={p.ad} className="relative flex h-dvh w-full snap-start snap-always items-center justify-center overflow-hidden bg-background px-4">
            {Math.abs(i - active) <= 1 && <AdSlot kind="shorts" className="w-full max-w-md" />}
            <p className="absolute bottom-8 inset-x-0 text-center text-xs text-muted-foreground">Swipe up to keep watching</p>
          </div>
        ) : (
          <div key={p.id} className="relative flex h-dvh w-full snap-start snap-always items-center justify-center overflow-hidden [contain:strict]">
            {Math.abs(i - active) <= 1
              ? <ShortSlide post={p} active={i === active} warm={i === active + 1} muted={muted} setMuted={setMuted} onShare={() => onShare(p)} />
              : <PostThumb post={p} className="absolute inset-0 h-full w-full" />}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link to="/" aria-label="Back to videos" className="flex h-11 items-center gap-1 rounded-full bg-black/50 pl-2 pr-4 text-sm font-semibold text-white hover:bg-black/70"><ArrowLeft className="h-6 w-6" />Back</Link>
          <Link to="/" aria-label="Home" className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><Home className="h-5 w-5" /></Link>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white">{muted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}</button>
          <Link to="/" aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><X className="h-6 w-6" /></Link>
        </div>
      </div>

      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-3 sm:flex">
        <button disabled={active === 0} onClick={() => goTo(active - 1)} aria-label="Previous short" className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30"><ChevronUp className="h-6 w-6" /></button>
        <button disabled={active >= shorts.length - 1} onClick={() => goTo(active + 1)} aria-label="Next short" className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white disabled:opacity-30"><ChevronDown className="h-6 w-6" /></button>
      </div>
    </div>
  );
}

function ShortSlide({ post, active, warm, muted, setMuted, onShare }: { post: PostT; active: boolean; warm: boolean; muted: boolean; setMuted: (m: boolean) => void; onShare: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [more, setMore] = useState(false);
  const eng = usePostEngagement(post.id, true, active);
  const src = parseVideoSource(post.videoUrl);

  useEffect(() => { const v = ref.current; if (!v || src.embed) return; return attachSource(v, post.videoUrl); }, [post.videoUrl, src.embed]);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (!active) { v.pause(); return; }
    setPaused(false);
    v.muted = muted;
    let gone = false;
    const start = () => {
      if (gone) return;
      if (!v.currentSrc && !v.src) return; // source not set yet — "canplay" will call us again
      v.play().catch((e: unknown) => {
        if (gone || (e as Error)?.name === "AbortError") return;
        v.muted = true; setMuted(true);
        v.play().catch(() => { if (!gone) setPaused(true); });
      });
    };
    if (v.currentTime > 0) v.currentTime = 0;
    start();
    v.addEventListener("canplay", start, { once: true });
    return () => { gone = true; v.removeEventListener("canplay", start); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);

  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) { v.play(); setPaused(false); } else { v.pause(); setPaused(true); } };
  const rail = "flex flex-col items-center gap-1 text-xs font-medium text-white";
  const btn = "grid h-12 w-12 place-items-center rounded-full bg-white/15 hover:bg-white/25";

  return (
    <div className="relative h-full w-full sm:aspect-[9/16] sm:w-auto sm:max-w-full sm:overflow-hidden sm:rounded-xl">
      {src.embed ? (
        active ? <iframe src={withAutoplay(src.embed)} title={post.title || "Short"} className="absolute inset-0 h-full w-full border-0" allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share" referrerPolicy="strict-origin-when-cross-origin" />
          : <PostThumb post={post} className="absolute inset-0 h-full w-full" />
      ) : (
        <>
          <video ref={ref} playsInline loop preload={active || warm ? "auto" : "none"} draggable={false} muted={muted}
            onClick={toggle} className="absolute inset-0 h-full w-full object-contain" />
        </>
      )}
      {paused && !src.embed && <button onClick={toggle} aria-label="Play" className="absolute inset-0 grid place-items-center"><span className="grid h-20 w-20 place-items-center rounded-full bg-black/50 text-white"><Play className="ml-1 h-10 w-10 fill-current" /></span></button>}

      <div className="absolute bottom-24 right-2 flex flex-col items-center gap-4 sm:bottom-6">
        <button onClick={() => eng.tap(1)} aria-pressed={eng.vote === 1} className={rail}><span className={btn}><ThumbsUp className={`h-6 w-6 ${eng.vote === 1 ? "fill-current" : ""}`} /></span>{eng.likes ? formatCount(eng.likes) : "Like"}</button>
        <button onClick={() => eng.tap(-1)} aria-pressed={eng.vote === -1} className={rail}><span className={btn}><ThumbsDown className={`h-6 w-6 ${eng.vote === -1 ? "fill-current" : ""}`} /></span>Dislike</button>
        <button onClick={onShare} className={rail}><span className={btn}><Share2 className="h-6 w-6" /></span>Share</button>
        {!src.embed && <button onClick={toggle} className={rail}><span className={btn}>{paused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}</span>{paused ? "Play" : "Pause"}</button>}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 pr-20 pt-16">
        <div className="pointer-events-auto flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-full bg-white/20 p-1" />
          <span className="text-sm font-semibold text-white">@LoopgramChannel</span>
        </div>
        <button onClick={() => setMore((m) => !m)} className="pointer-events-auto mt-2 block text-left text-sm text-white">
          <span className="font-semibold">{post.title || "Short"}</span>{eng.views > 0 && <span className="ml-2 text-white/75">{viewsLabel(eng.views)}</span>}
          {post.text && <span className={`mt-1 block whitespace-pre-line text-white/85 ${more ? "max-h-[40vh] overflow-y-auto" : "line-clamp-2"}`}>{post.text}</span>}
        </button>
      </div>
    </div>
  );
}
