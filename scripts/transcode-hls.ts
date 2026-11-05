// Turns one video file into adaptive HLS (360p/480p/720p/1080p) and uploads it to R2 next to the source.
//   bun scripts/transcode-hls.ts <file> post <post video URL>   (Shorts / Studio posts)
//   bun scripts/transcode-hls.ts <file> key media/originals/my-short   (any custom R2 folder)
// Needs ffmpeg/ffprobe on PATH and the R2_* env vars. Segments are immutable (cached 1 year at the edge);
// playlists get a short cache so a re-upload shows up quickly.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AwsClient } from "aws4fetch";

const LADDER = [
  { name: "360p", h: 360, v: 600, a: 64 },
  { name: "480p", h: 480, v: 1000, a: 96 },
  { name: "720p", h: 720, v: 2500, a: 128 },
  { name: "1080p", h: 1080, v: 4500, a: 160 },
];

export function stemFor(args: string[]): string {
  const [kind, a] = args;
  if (kind === "post") {
    // A Studio post video URL: .../media/originals/<id>.<ext> → media/originals/<id> (the player looks for <id>/index.m3u8).
    const m = /\/(media\/originals\/[\w-]+)\.(mp4|mov|webm|m4v)(\?.*)?$/i.exec(a ?? "");
    if (m) return m[1]!;
  }
  if (kind === "key" && a && /^[\w\-/.]+$/.test(a) && !a.includes("..")) return a.replace(/^\/+|\/+$/g, "");
  throw new Error("Usage: <file> post <videoUrl> | key <r2/folder>");
}

/** Only renditions at or below the source height (never upscale); always at least the lowest rung. */
export function pickLadder(sourceHeight: number) {
  const fit = LADDER.filter((r) => r.h <= sourceHeight + 8);
  return fit.length ? fit : [LADDER[0]!];
}

export function contentType(file: string) {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

export function cacheControl(file: string) {
  return file.endsWith(".m3u8") ? "public, max-age=60, s-maxage=300" : "public, max-age=31536000, immutable";
}

function probe(file: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const streams = JSON.parse(r.stdout).streams as { codec_type: string; width?: number; height?: number }[];
  const v = streams.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error("No video stream found");
  return { width: v.width, height: v.height, audio: streams.some((s) => s.codec_type === "audio") };
}

function transcode(input: string, out: string, info: ReturnType<typeof probe>) {
  const rungs = pickLadder(Math.min(info.width, info.height));
  const portrait = info.height > info.width;
  const split = `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join("")}`;
  // Scale the short side to the rung height, keep aspect, even dimensions — no crop, no stretch.
  const scales = rungs.map((r, i) => `[s${i}]scale=${portrait ? `${r.h}:-2` : `-2:${r.h}`}[v${i}]`);
  const args = ["-y", "-i", input, "-filter_complex", [split, ...scales].join(";")];
  rungs.forEach((r, i) => {
    args.push("-map", `[v${i}]`, `-c:v:${i}`, "libx264", `-b:v:${i}`, `${r.v}k`, `-maxrate:v:${i}`, `${Math.round(r.v * 1.07)}k`, `-bufsize:v:${i}`, `${r.v * 2}k`);
    if (info.audio) args.push("-map", "0:a:0", `-c:a:${i}`, "aac", `-b:a:${i}`, `${r.a}k`, "-ac", "2");
  });
  args.push(
    "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*4)", "-sc_threshold", "0",
    "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
    "-hls_segment_filename", join(out, "%v", "seg_%05d.ts"),
    "-master_pl_name", "index.m3u8",
    "-var_stream_map", rungs.map((r, i) => (info.audio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(" "),
    join(out, "%v", "stream.m3u8"),
  );
  console.log(`Encoding ${rungs.map((r) => r.name).join(", ")} …`);
  const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error("ffmpeg failed");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

async function upload(dir: string, stem: string) {
  const need = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET_NAME"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  const c = new AwsClient({ accessKeyId: process.env["R2_ACCESS_KEY_ID"]!, secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"]!, service: "s3", region: "auto" });
  const base = `${process.env["R2_ENDPOINT"]!.replace(/\/$/, "")}/${process.env["R2_BUCKET_NAME"]}`;
  // Segments first, master playlist last, so a viewer never sees a playlist pointing at missing chunks.
  const files = walk(dir).sort((a, b) => Number(a.endsWith("index.m3u8")) - Number(b.endsWith("index.m3u8")) || Number(a.endsWith(".m3u8")) - Number(b.endsWith(".m3u8")));
  const master = files.filter((f) => f.endsWith(".m3u8"));
  const segs = files.filter((f) => !f.endsWith(".m3u8"));
  let done = 0;
  const put = async (f: string) => {
    const key = `${stem}/${relative(dir, f).split("\\").join("/")}`;
    for (let attempt = 1; ; attempt++) {
      const r = await c.fetch(`${base}/${key}`, { method: "PUT", body: readFileSync(f), headers: { "content-type": contentType(f), "cache-control": cacheControl(f) } }).catch((e) => e as Error);
      if (r instanceof Response && r.ok) break;
      if (attempt >= 4) throw new Error(`Upload failed for ${key}: ${r instanceof Response ? r.status : r.message}`);
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt));
    }
    done++; if (done % 25 === 0 || done === files.length) console.log(`Uploaded ${done}/${files.length}`);
  };
  const pool = async (list: string[], n: number) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) await put(list[i++]!); })); };
  await pool(segs, 8);
  await pool(master.filter((f) => !f.endsWith("index.m3u8")), 4);
  await pool(master.filter((f) => f.endsWith("index.m3u8")), 1);
}

if (import.meta.main) {
  const [input, ...rest] = process.argv.slice(2);
  if (!input) { console.error("Usage: bun scripts/transcode-hls.ts <file> movie <id> | tv <id> <s> <e> | key <folder>"); process.exit(1); }
  const stem = stemFor(rest);
  const out = mkdtempSync(join(tmpdir(), "hls-"));
  try {
    const info = probe(input);
    console.log(`Source ${info.width}x${info.height}${info.audio ? " + audio" : ""} → r2://${stem}/index.m3u8`);
    transcode(input, out, info);
    await upload(out, stem);
    // Drop the cached "no stream" answer so the site picks up the new HLS straight away.
    try { const { redis } = await import("../src/lib/backend.server"); await redis(["DEL", `stream:v1:${stem}`]); } catch { /* cache optional */ }
    const pub = (process.env["R2_PUBLIC_URL"] ?? "").replace(/\/$/, "");
    console.log(`Done: ${pub ? `${pub}/${stem}/index.m3u8` : `${stem}/index.m3u8`}`);
  } finally { rmSync(out, { recursive: true, force: true }); }
}
