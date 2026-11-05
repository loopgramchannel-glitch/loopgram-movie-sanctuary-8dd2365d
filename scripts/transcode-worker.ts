// Real-time transcoder: leases { kind: "transcode", key } jobs from the Cloudflare D1 `jobs` table,
// converts with ffmpeg and uploads HLS to R2.
//   bun scripts/transcode-worker.ts          (runs forever; run several copies to scale out)
//   bun scripts/transcode-worker.ts --drain  (exits once no transcode jobs are waiting)
// Needs ffmpeg + CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_D1_TOKEN + R2_* (+ optional UPSTASH_*).
// Safe for duplicate delivery: convertOne() skips stems that already have index.m3u8.
import { MAX_RECEIVES, parseJob } from "../src/lib/jobs";
import { claimJobs, finishJob, retryJob } from "../src/lib/queue.server";
import { d1 } from "../src/lib/backend.server";
import { convertOne } from "./convert-posts";

const drain = process.argv.includes("--drain");
const LEASE = 15 * 60_000;
let stop = false;
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { stop = true; console.log("Stopping after current job…"); });

let idle = 0;
while (!stop) {
  let rows;
  try { rows = await claimJobs(1, "transcode", LEASE); }
  catch (e) { console.error(String(e)); await Bun.sleep(5000); continue; }
  const m = rows[0];
  if (!m) { if (drain && ++idle >= 2) break; await Bun.sleep(drain ? 2000 : 15000); continue; }
  idle = 0;
  const job = parseJob(m.payload);
  if (job?.kind !== "transcode") { await finishJob(m.id); continue; }
  // Keep the lease alive while a long video converts.
  const keepAlive = setInterval(() => { d1("UPDATE jobs SET locked_until = ?2 WHERE id = ?1", [m.id, Date.now() + LEASE]).catch(() => {}); }, 300_000);
  try {
    const res = await convertOne(job.key);
    await finishJob(m.id);
    console.log(`${res} ${job.key}`);
  } catch (e) {
    console.error(`Failed ${job.key} (try ${m.attempts}):`, e instanceof Error ? e.message : e);
    // Give up after MAX_RECEIVES; the full scan in convert-posts.ts still retries it later.
    if (m.attempts >= MAX_RECEIVES) await finishJob(m.id).catch(() => {});
    else await retryJob(m.id, 60 * m.attempts).catch(() => {});
  } finally { clearInterval(keepAlive); }
}
console.log("Worker stopped.");
