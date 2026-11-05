// Studio: saves the owner's original uploaded file to the device (clean file, no player or logos).
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { studioDownloadUrl } from "@/lib/upload.functions";

/** Turns a public bucket URL or a raw key into the bucket key. */
export function keyFromUrl(u: string): string {
  try { return decodeURIComponent(new URL(u).pathname.replace(/^\//, "")); } catch { return u; }
}

export function DownloadButton({ fileKey, label = "Download", className }: { fileKey: string; label?: string; className?: string }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!fileKey.startsWith("media/")) return null;
  const go = async () => {
    setBusy(true);
    try {
      const token = await getToken(); if (!token) throw new Error("Not signed in");
      const { url } = await studioDownloadUrl({ data: { token, key: fileKey } });
      window.location.href = url; // server forces "save file", so the page stays put
    } catch (e) { toast.error((e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "")); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={go} disabled={busy} aria-label={`${label} ${fileKey}`}
      className={className ?? "inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50"}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}{label}
    </button>
  );
}
