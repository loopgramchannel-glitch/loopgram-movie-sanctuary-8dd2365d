import { useEffect, useRef, useState } from "react";

/**
 * YouTube embed that shows its thumbnail + spinner instantly, then reveals the player once the iframe loads.
 * Listens for player errors (100 removed/private, 101/150/153 embedding or region blocked) and never spins forever.
 */
export function YouTubePlayer({ id, onFail, title = "Trailer" }: { id: string; onFail: () => void; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "slow">("loading");
  const failRef = useRef(onFail);
  failRef.current = onFail;
  useEffect(() => {
    setState("loading");
    let got = false, done = false;
    const onMsg = (e: MessageEvent) => {
      let host = "";
      try { host = new URL(e.origin).hostname; } catch { return; }
      if (!/youtube(-nocookie)?\.com$/.test(host) || e.source !== ref.current?.contentWindow) return;
      let m: any; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      got = true;
      if (m?.event === "onReady" || m?.event === "initialDelivery") setState("ready");
      if (m?.event === "onError" && !done) {
        done = true; setState("error");
        // Blocked/removed clip: skip to the next playable one almost immediately.
        setTimeout(() => failRef.current(), 300);
      }
    };
    addEventListener("message", onMsg);
    // Keep handshaking until the player answers, so errors are always reported even on slow networks.
    const t = setInterval(() => { if (got) clearInterval(t); else listen(); }, 400);
    // On very slow connections, tell the user what's happening instead of an endless spinner.
    const slow = setTimeout(() => setState((s) => (s === "loading" ? "slow" : s)), 12000);
    return () => { removeEventListener("message", onMsg); clearInterval(t); clearTimeout(slow); };
  }, [id]);
  const listen = () => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  const origin = typeof location !== "undefined" ? location.origin : "";
  const loading = state === "loading" || state === "slow";
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {loading && <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
      <iframe ref={ref} onLoad={() => { listen(); setState((s) => (s === "error" ? s : "ready")); }} className="relative h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`}
        title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="grid place-items-center gap-2">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted-foreground border-t-primary" aria-label="Loading video" />
            {state === "slow" && <p className="rounded bg-background/80 px-2 py-1 text-xs">Slow connection — still loading…</p>}
          </div>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm">
          <div>
            <p>This video can't play here. Skipping to the next one…</p>
            <button onClick={() => failRef.current()} className="mt-3 rounded-full bg-primary px-4 py-1.5 text-primary-foreground">Next video now</button>
          </div>
        </div>
      )}
    </div>
  );
}
