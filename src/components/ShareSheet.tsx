import { useEffect, useState } from "react";
import { Copy, Mail, MessageCircle, Share2, X } from "lucide-react";
import { copyText, nativeShare, SHARE_EVENT, shareTargets, type SharePayload } from "@/lib/share";

/** One share window for the whole app; opened by shareLink() from anywhere. */
export function ShareSheet() {
  const [p, setP] = useState<SharePayload | null>(null);
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<SharePayload>).detail);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setP(null);
    window.addEventListener(SHARE_EVENT, on);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener(SHARE_EVENT, on); window.removeEventListener("keydown", esc); };
  }, []);
  if (!p) return null;
  const targets = shareTargets(p);
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-background/70 backdrop-blur-sm sm:items-center" onClick={() => setP(null)}>
      <div role="dialog" aria-label="Share" className="w-full max-w-md rounded-t-2xl border bg-card p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold">Share</h2>
            {p.title && <p className="truncate text-xs text-muted-foreground">{p.title}</p>}
          </div>
          <button aria-label="Close" onClick={() => setP(null)} className="rounded-full p-2 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {targets.map((t) => (
            <a key={t.name} href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setP(null), 200)} className="flex flex-col items-center gap-1.5 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full" style={{ background: `#${t.icon.hex}` }}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff" aria-hidden="true"><path d={t.icon.path} /></svg>
              </span>
              <span className="text-[11px] leading-tight">{t.name}</span>
            </a>
          ))}
          <a href={`mailto:?subject=${encodeURIComponent(p.title ?? "")}&body=${encodeURIComponent(`${p.text ?? ""} ${p.url}`.trim())}`} className="flex flex-col items-center gap-1.5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary"><Mail className="h-5 w-5" /></span><span className="text-[11px]">Email</span>
          </a>
          <a href={`sms:?&body=${encodeURIComponent(`${p.text ?? p.title ?? ""} ${p.url}`.trim())}`} className="flex flex-col items-center gap-1.5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary"><MessageCircle className="h-5 w-5" /></span><span className="text-[11px]">SMS</span>
          </a>
          <button onClick={() => { const cur = p; setP(null); void nativeShare(cur); }} className="flex flex-col items-center gap-1.5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary"><Share2 className="h-5 w-5" /></span><span className="text-[11px]">More apps</span>
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-full border bg-background p-1 pl-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.url}</span>
          <button onClick={() => copyText(p.text ? `${p.text} ${p.url}` : p.url)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><Copy className="h-3.5 w-3.5" />Copy</button>
        </div>
      </div>
    </div>
  );
}
