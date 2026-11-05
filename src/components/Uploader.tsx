// Studio file picker that sends a file straight to the owner's R2 bucket with a live progress bar.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { studioEnableUploads, studioUploadDone, studioUploadUrl } from "@/lib/upload.functions";
import { IMAGE_TYPES, VIDEO_TYPES, type UploadTargetT } from "@/lib/upload-keys";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");
const mb = (n: number) => (n / 1048576).toFixed(n > 1e9 ? 0 : 1);

/** Sends a small file (e.g. an auto-made thumbnail) straight to R2 without the progress UI. */
export async function uploadBlob(token: string, target: UploadTargetT, blob: Blob, type: string) {
  const ticket = await studioUploadUrl({ data: { token, target, contentType: type, size: blob.size } });
  const r = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: blob });
  if (!r.ok) throw new Error("Upload didn't finish");
  await studioUploadDone({ data: { token, key: ticket.key } }).catch(() => {});
  return ticket.publicUrl;
}

export function Uploader({ target, label, onDone, compact }: { target: UploadTargetT; label: string; onDone?: (r: { key: string; publicUrl: string; fileName?: string; file?: File }) => void; compact?: boolean }) {
  const { getToken } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [p, setP] = useState<{ name: string; sent: number; total: number; speed: number } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const accept = (target.kind === "image" ? IMAGE_TYPES : target.kind === "original-video" ? VIDEO_TYPES : ["video/mp4"]).join(",");

  const start = async (file: File) => {
    const token = await getToken();
    if (!token) { toast.error("Please sign in again"); return; }
    // Phones sometimes leave the type blank for .mov files.
    const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : /\.mp4$/i.test(file.name) ? "video/mp4" : "");
    let ticket: { uploadUrl: string; key: string; publicUrl: string };
    try { ticket = await studioUploadUrl({ data: { token, target, contentType: type, size: file.size } }); }
    catch (e) { toast.error(errText(e)); return; }
    const t0 = Date.now();
    setP({ name: file.name, sent: 0, total: file.size, speed: 0 });
    const ok = await new Promise<boolean>((resolve) => {
      const x = new XMLHttpRequest();
      xhr.current = x;
      x.open("PUT", ticket.uploadUrl);
      x.setRequestHeader("Content-Type", type);
      x.upload.onprogress = (ev) => setP({ name: file.name, sent: ev.loaded, total: ev.total || file.size, speed: ev.loaded / Math.max(0.5, (Date.now() - t0) / 1000) });
      x.onload = () => resolve(x.status >= 200 && x.status < 300);
      x.onerror = () => { setBlocked(true); resolve(false); };
      x.onabort = () => resolve(false);
      x.send(file);
    });
    xhr.current = null;
    setP(null);
    if (!ok) { toast.error("Upload didn't finish. Try again."); return; }
    try { await studioUploadDone({ data: { token, key: ticket.key } }); } catch { /* caches clear on their own soon */ }
    toast.success("Uploaded");
    setBlocked(false);
    onDone?.({ key: ticket.key, publicUrl: ticket.publicUrl, fileName: file.name, file });
  };

  const enable = async () => {
    const token = await getToken();
    if (!token) return;
    try { await studioEnableUploads({ data: { token } }); toast.success("Uploads allowed. Try your file again."); setBlocked(false); }
    catch (e) { toast.error(errText(e)); }
  };

  const pct = p ? Math.round((p.sent / p.total) * 100) : 0;
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void start(f); }} />
      {!p && (
        <button type="button" onClick={() => input.current?.click()} className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 ${compact ? "h-9 text-xs" : "h-11 text-sm"} hover:bg-accent`}>
          <Upload className="h-4 w-4" />{label}
        </button>
      )}
      {p && (
        <div className="rounded-lg border p-3 text-xs">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <button type="button" aria-label="Cancel upload" onClick={() => xhr.current?.abort()}><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 text-muted-foreground">{pct}% · {mb(p.sent)} / {mb(p.total)} MB · {mb(p.speed)} MB/s</div>
        </div>
      )}
      {blocked && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Your media bucket blocked the upload. This is a one-time setting.
          <button type="button" onClick={enable} className="ml-2 font-semibold underline">Allow uploads from Studio</button>
        </div>
      )}
    </div>
  );
}
