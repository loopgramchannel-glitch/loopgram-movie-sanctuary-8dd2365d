import { toast } from "sonner";
import { siFacebook, siMessenger, siPinterest, siReddit, siTelegram, siThreads, siWhatsapp, siX } from "simple-icons";

export type SharePayload = { title?: string; text?: string; url: string };
export const SHARE_EVENT = "lg-share";

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function copyText(payload: string) {
  try {
    await navigator.clipboard.writeText(payload);
    toast.success("Link copied");
    return;
  } catch {}
  if (legacyCopy(payload)) toast.success("Link copied");
  else toast("Copy this link", { description: payload, duration: 10000 });
}

/** Direct share links for the big apps. Brand colors are the apps' own identities. */
export function shareTargets(p: SharePayload) {
  const u = encodeURIComponent(p.url);
  const msg = (p.text ?? p.title ?? "").trim();
  const m = encodeURIComponent(msg);
  const mu = encodeURIComponent(msg ? `${msg} ${p.url}` : p.url);
  return [
    { name: "WhatsApp", icon: siWhatsapp, href: `https://wa.me/?text=${mu}` },
    { name: "Facebook", icon: siFacebook, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "X", icon: siX, href: `https://twitter.com/intent/tweet?text=${m}&url=${u}` },
    { name: "Telegram", icon: siTelegram, href: `https://t.me/share/url?url=${u}&text=${m}` },
    { name: "Messenger", icon: siMessenger, href: `fb-messenger://share/?link=${u}` },
    { name: "Reddit", icon: siReddit, href: `https://www.reddit.com/submit?url=${u}&title=${m}` },
    { name: "Pinterest", icon: siPinterest, href: `https://pinterest.com/pin/create/button/?url=${u}&description=${m}` },
    { name: "Threads", icon: siThreads, href: `https://www.threads.net/intent/post?text=${mu}` },
  ];
}

/** Phone's own share menu; if blocked or missing, copies the link instead. */
export async function nativeShare(p: SharePayload) {
  const full = p.text ? `${p.text} ${p.url}` : p.url;
  const data: ShareData = { url: p.url, ...(p.title ? { title: p.title } : {}), ...(p.text ? { text: p.text } : {}) };
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      await navigator.share(data);
      return;
    }
    if (navigator.share) { await navigator.share({ url: p.url }); return; }
  } catch (e: any) {
    if (e?.name === "AbortError") return; // user closed the menu
  }
  await copyText(full);
  toast("Paste the link into any app", { duration: 4000 });
}

/** Opens the app's share window with every big app plus copy link. */
export async function shareLink(opts: SharePayload) {
  window.dispatchEvent(new CustomEvent<SharePayload>(SHARE_EVENT, { detail: opts }));
}
