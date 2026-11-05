// Browser-only: plays a Studio-uploaded post video as adaptive HLS when a converted copy exists in R2
// (made by scripts/transcode-hls.ts `post <videoUrl>`), otherwise the original file. Never throws.

/** media/originals/abc.mp4 → media/originals/abc/index.m3u8 ; null for anything not a Studio original. */
export function hlsFor(url: string): string | null {
  const m = /^(https:\/\/[^?#]+\/media\/originals\/[\w-]+)\.(mp4|mov|webm|m4v)(\?.*)?$/i.exec(url);
  return m ? `${m[1]}/index.m3u8` : null;
}

// Remembers which originals have a converted HLS copy, so a missing one (404) costs one tiny HEAD check per session
// instead of a failed player start on every swipe.
const hlsKnown = new Map<string, Promise<boolean>>();
function hasHls(u: string): Promise<boolean> {
  const hit = hlsKnown.get(u);
  if (hit) return hit;
  let p: Promise<boolean>;
  let stored: string | null = null;
  try { stored = sessionStorage.getItem(`lg:hls:${u}`); } catch { /* storage off */ }
  if (stored) p = Promise.resolve(stored === "1");
  else p = fetch(u, { method: "HEAD" }).then((r) => r.ok).catch(() => false).then((ok) => {
    try { sessionStorage.setItem(`lg:hls:${u}`, ok ? "1" : "0"); } catch { /* ignore */ }
    return ok;
  });
  hlsKnown.set(u, p);
  return p;
}

/** Attaches the best source to the element; returns a cleanup. */
export function attachSource(v: HTMLVideoElement, url: string): () => void {
  const hls = hlsFor(url);
  let dead = false, inst: { destroy: () => void } | null = null, offErr: (() => void) | null = null;
  const fallback = () => { if (dead) return; inst?.destroy(); inst = null; if (v.src !== url) { v.src = url; v.load(); } };
  if (!hls) { v.src = url; return () => { dead = true; }; }
  // Unknown HLS status: start the original file at once (no blank player while we ask), and remember the
  // answer in the background so the next open uses the streaming copy if it exists.
  let known: string | null = null;
  try { known = sessionStorage.getItem(`lg:hls:${hls}`); } catch { /* storage off */ }
  if (known !== "1") { v.src = url; if (known === null) void hasHls(hls); return () => { dead = true; }; }
  hasHls(hls).then((ok) => {
    if (dead) return;
    if (!ok) return fallback();
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      const onErr = () => { v.removeEventListener("error", onErr); fallback(); };
      v.addEventListener("error", onErr);
      offErr = () => v.removeEventListener("error", onErr);
      v.src = hls;
      return;
    }
    return import("hls.js").then(({ default: Hls }) => {
      if (dead) return;
      if (!Hls.isSupported()) return fallback();
      const h = new Hls({ manifestLoadingMaxRetry: 0, fragLoadingMaxRetry: 3, capLevelToPlayerSize: true, maxBufferLength: 20 });
      inst = h;
      h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; type?: string }) => {
        if (!d?.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError(); else fallback();
      });
      h.loadSource(hls);
      h.attachMedia(v);
    });
  }).catch(fallback);
  return () => { dead = true; offErr?.(); inst?.destroy(); };
}
