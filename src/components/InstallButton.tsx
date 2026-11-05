import { useEffect, useState } from "react";
import { Download, Share, PlusSquare, MoreVertical, X } from "lucide-react";

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Platform = "ios" | "android" | "desktop" | "inapp";

function detect(): Platform {
  const ua = navigator.userAgent || "";
  if (/FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|Twitter|MicroMessenger/i.test(ua)) return "inapp";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || iPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const GUIDES: Record<Platform, { title: string; steps: { icon: typeof Share; text: string }[] }> = {
  ios: { title: "Install on iPhone / iPad", steps: [
    { icon: Share, text: "In Safari, tap the Share button at the bottom of the screen." },
    { icon: PlusSquare, text: "Scroll down and tap \"Add to Home Screen\", then tap Add." },
  ] },
  android: { title: "Install on Android", steps: [
    { icon: MoreVertical, text: "Tap the ⋮ menu in the top-right corner of Chrome." },
    { icon: PlusSquare, text: "Tap \"Install app\" or \"Add to Home screen\"." },
  ] },
  desktop: { title: "Install on Windows / Mac / Linux", steps: [
    { icon: Download, text: "In Chrome or Edge, click the install icon at the right end of the address bar." },
    { icon: MoreVertical, text: "Or open the browser menu and choose \"Install LoopgramChannel\". On Mac Safari: File → Add to Dock." },
  ] },
  inapp: { title: "Open in your browser first", steps: [
    { icon: MoreVertical, text: "Tap the ⋯ menu and choose \"Open in browser\" (Chrome or Safari)." },
    { icon: PlusSquare, text: "Then tap Install again to add LoopgramChannel to your home screen." },
  ] },
};

/** Always-visible install button: native prompt when available, otherwise a device-specific guide. */
export function InstallButton() {
  const [evt, setEvt] = useState<Prompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  useEffect(() => {
    setPlatform(detect());
    setInstalled(matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    const on = (e: Event) => { e.preventDefault(); setEvt(e as Prompt); };
    const done = () => { setEvt(null); setInstalled(true); setOpen(false); };
    addEventListener("beforeinstallprompt", on);
    addEventListener("appinstalled", done);
    return () => { removeEventListener("beforeinstallprompt", on); removeEventListener("appinstalled", done); };
  }, []);
  if (installed) return null;
  const click = async () => {
    if (evt) { await evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); return; }
    setOpen(true);
  };
  const g = GUIDES[platform];
  return (
    <>
      <button onClick={click}
        className="inline-flex items-center gap-1 rounded-full p-2 text-sm hover:bg-accent sm:px-3 sm:py-1.5"
        aria-label="Install app" title="Install LoopgramChannel">
        <Download className="h-5 w-5 sm:h-4 sm:w-4" /><span className="hidden sm:inline">Install</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={g.title}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 text-card-foreground shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <img src="/icon.svg" alt="" className="h-10 w-10" />
              <h2 className="flex-1 text-base font-bold">{g.title}</h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 hover:bg-accent" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <ol className="space-y-3">
              {g.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 rounded-xl bg-secondary p-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                  <span className="flex-1">{s.text}</span>
                  <s.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
              {(Object.keys(GUIDES) as Platform[]).map((p) => (
                <button key={p} onClick={() => setPlatform(p)} className={`rounded-full border px-2.5 py-1 ${p === platform ? "bg-accent font-semibold" : ""}`}>
                  {p === "ios" ? "iPhone" : p === "android" ? "Android" : p === "desktop" ? "Computer" : "In-app"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
