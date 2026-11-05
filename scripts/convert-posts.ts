// Converts every owner video in R2 that has no HLS copy yet: Studio posts (media/originals/*).
//   bun scripts/convert-posts.ts      (needs ffmpeg + R2_* env vars; safe to re-run, skips done ones)
// Runs automatically every 10 minutes from .github/workflows/auto-transcode.yml.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";

const c = new AwsClient({ accessKeyId: process.env["R2_ACCESS_KEY_ID"]!, secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"]!, service: "s3", region: "auto" });
const base = `${process.env["R2_ENDPOINT"]!.replace(/\/$/, "")}/${process.env["R2_BUCKET_NAME"]}`;
const pub = process.env["R2_PUBLIC_URL"]!.replace(/\/$/, "");

/** Source videos the player can switch to HLS: same stems hlsFor() looks up. */
import { TRANSCODE_SOURCE as SOURCE } from "../src/lib/jobs";

async function list(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token = "";
  do {
    const x = await (await c.fetch(`${base}?list-type=2&prefix=${prefix}${token ? `&continuation-token=${encodeURIComponent(token)}` : ""}`)).text();
    for (const m of x.matchAll(/<Key>([^<]+)<\/Key>/g)) if (SOURCE.test(m[1]!)) out.push(m[1]!);
    token = /<IsTruncated>true/.test(x) ? (/<NextContinuationToken>([^<]+)/.exec(x)?.[1] ?? "") : "";
  } while (token);
  return out;
}

/** Drops the cached "mp4 only" answer so the site switches to HLS right away. */
async function clearCache(stem: string) {
  const url = process.env["UPSTASH_REDIS_REST_URL"], tok = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !tok) return;
  await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(["DEL", `stream:v1:${stem}`, "uploads:ids:v1"]) }).catch(() => {});
}

/** Converts one source video to HLS. Returns "skipped" when an HLS copy already exists. Throws on failure. */
export async function convertOne(k: string): Promise<"converted" | "skipped"> {
  const stem = k.replace(/\.[^.]+$/, "");
  if ((await fetch(`${pub}/${stem}/index.m3u8`, { method: "HEAD" })).ok) return "skipped";
  const f = join(tmpdir(), `src-${stem.replace(/\//g, "_")}.${k.split(".").pop()}`);
  try {
    const r = await c.fetch(`${base}/${k}`);
    if (r.status === 404) return "skipped"; // file was deleted before we got to it
    if (!r.ok) throw new Error(`download ${r.status}`);
    await Bun.write(f, r); // streams to disk, so multi-GB movies don't fill memory
    console.log(`Converting ${k}`);
    const res = spawnSync("bun", [join(import.meta.dir, "transcode-hls.ts"), f, "key", stem], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`transcode exit ${res.status}`);
    await clearCache(stem);
    return "converted";
  } finally { rmSync(f, { force: true }); }
}

if (import.meta.main) {
  const keys = (await Promise.all(["media/originals/"].map(list))).flat();
  let converted = 0, failed = 0;
  for (const k of keys) {
    try { if ((await convertOne(k)) === "converted") converted++; }
    catch (e) { failed++; console.error(`Failed ${k}:`, e instanceof Error ? e.message : e); }
  }
  console.log(`Checked ${keys.length} videos, converted ${converted}, failed ${failed}.`);
  if (failed) process.exit(1);
}
