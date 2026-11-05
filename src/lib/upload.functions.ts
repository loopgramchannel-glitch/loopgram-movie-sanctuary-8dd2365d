// Owner-only Studio uploads: the browser sends files straight to R2 with a short-lived signed link,
// so large videos never pass through the app server. Every call re-verifies the owner.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UploadTarget, isDeletableKey, uploadKey } from "./upload-keys";

const tok = z.object({ token: z.string().min(20).max(4096) });

async function owner(token: string) {
  const { requireOwner, AuthError } = await import("./auth.server");
  try { return await requireOwner(token); }
  catch (e) { if (e instanceof AuthError) throw new Error(`${e.status}: ${e.message}`); throw new Error("401: Could not verify session"); }
}

async function r2() {
  const need = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME", "R2_PUBLIC_URL"];
  if (need.some((k) => !process.env[k])) throw new Error("503: Media bucket isn't set up.");
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId: process.env["R2_ACCESS_KEY_ID"]!, secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"]!, service: "s3", region: "auto" });
  const bucketUrl = `${process.env["R2_ENDPOINT"]!.replace(/\/$/, "")}/${process.env["R2_BUCKET_NAME"]}`;
  const publicBase = process.env["R2_PUBLIC_URL"]!.replace(/\/$/, "");
  return { client, bucketUrl, publicBase };
}

const encKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");

/** Clears caches that remember "no file here" so a new upload plays right away. */
async function clearStreamCaches(key: string) {
  const { redis } = await import("./backend.server");
  const stem = key.replace(/(\/index\.m3u8|\.mp4)$/, "");
  await Promise.all([redis(["DEL", `stream:v1:${stem}`]), redis(["DEL", "uploads:ids:v1"])]).catch(() => {});
}

export const studioUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ target: UploadTarget, contentType: z.string().max(100), size: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const rand = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const k = uploadKey(data.target, data.contentType, data.size, rand);
    if ("error" in k) throw new Error(`400: ${k.error}`);
    const { client, bucketUrl, publicBase } = await r2();
    const url = new URL(`${bucketUrl}/${encKey(k.key)}`);
    url.searchParams.set("X-Amz-Expires", "3600");
    const signed = await client.sign(url.toString(), { method: "PUT", headers: { "Content-Type": data.contentType }, aws: { signQuery: true } });
    const { audit } = await import("./auth.server");
    void audit(me, "media.upload.start", k.key, "ok", { size: data.size, type: data.contentType });
    return { uploadUrl: signed.url, key: k.key, publicUrl: `${publicBase}/${encKey(k.key)}` };
  });

export const studioUploadDone = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ key: z.string().max(500) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    if (!isDeletableKey(data.key)) throw new Error("400: Unknown file.");
    await clearStreamCaches(data.key);
    // New owner video: queue adaptive-quality conversion. If the queue is down, the 10-minute scan still finds it.
    const { TRANSCODE_SOURCE } = await import("./jobs");
    let queued = false;
    if (TRANSCODE_SOURCE.test(data.key)) { const { sendJob } = await import("./sqs.server"); queued = await sendJob({ kind: "transcode", key: data.key }); }
    const { audit } = await import("./auth.server");
    await audit(me, "media.upload.done", data.key, "ok", { transcodeQueued: queued });
    return { ok: true };
  });

/** Owner-only: short-lived link that makes the phone/computer save the original file (no player, no logos). */
export const studioDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ key: z.string().max(500) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    if (!isDeletableKey(data.key)) throw new Error("400: Only your own uploaded files can be downloaded.");
    const { client, bucketUrl } = await r2();
    const name = (data.key.split("/").pop() || "video.mp4").replace(/[^A-Za-z0-9._-]/g, "_");
    const url = new URL(`${bucketUrl}/${encKey(data.key)}`);
    url.searchParams.set("X-Amz-Expires", "600");
    url.searchParams.set("response-content-disposition", `attachment; filename="loopgram-${name}"`);
    const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    const { audit } = await import("./auth.server");
    void audit(me, "media.download", data.key, "ok");
    return { url: signed.url };
  });

export const studioDeleteMedia = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.extend({ key: z.string().max(500) }).parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    if (!isDeletableKey(data.key)) throw new Error("400: Only your own uploads (under media/) can be deleted.");
    const { client, bucketUrl } = await r2();
    const r = await client.fetch(`${bucketUrl}/${encKey(data.key)}`, { method: "DELETE", signal: AbortSignal.timeout(8000) });
    const { audit } = await import("./auth.server");
    await audit(me, "media.delete", data.key, r.ok ? "ok" : "failed");
    if (!r.ok && r.status !== 404) throw new Error(`502: The bucket refused the delete (${r.status}).`);
    await clearStreamCaches(data.key);
    return { ok: true };
  });

/** One-time bucket setting so browsers may send files to it. Signed links stay the only way in. */
export const studioEnableUploads = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tok.parse(d))
  .handler(async ({ data }) => {
    const me = await owner(data.token);
    const { client, bucketUrl } = await r2();
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
    const r = await client.fetch(`${bucketUrl}?cors`, { method: "PUT", body: xml, headers: { "Content-Type": "application/xml" }, signal: AbortSignal.timeout(8000) });
    const { audit } = await import("./auth.server");
    await audit(me, "media.cors.enable", "bucket", r.ok ? "ok" : "failed", { status: r.status });
    if (!r.ok) throw new Error(`502: The bucket refused the setting (${r.status}). Your R2 key may need "Admin Read & Write" permission.`);
    return { ok: true };
  });
