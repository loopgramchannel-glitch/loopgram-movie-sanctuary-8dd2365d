// Server-only job queue on Cloudflare D1 (table `jobs`). Replaces the old external queue.
// A job is claimed by setting locked_until (a lease); finished jobs are deleted; failures get a backoff via run_after.
import { d1, redis, redisPipeline } from "./backend.server";
import { backoffSeconds, failureAction, jobKey, parseJob, type AnyJob, type QueueJob, type StatJob } from "./jobs";
import { log } from "./log.server";
import type { SearchJob } from "./search-index";

const DEAD_KEY = "lg:jobs:dead";
const LEASE_MS = 60_000;

/** Producer. Returns false (never throws) when the queue is unavailable so callers can run the job inline. */
export async function sendJob(job: AnyJob): Promise<boolean> {
  try {
    const now = Date.now();
    // Transcode jobs use their key as id, so the same upload is queued once.
    const id = job.kind === "transcode" ? jobKey(job) : crypto.randomUUID();
    await d1("INSERT OR IGNORE INTO jobs (id, kind, payload, attempts, run_after, locked_until, created_at) VALUES (?1, ?2, ?3, 0, 0, 0, ?4)",
      [id, job.kind, JSON.stringify({ ...job, v: 1 } satisfies QueueJob), now]);
    return true;
  } catch (e) { log("warn", "queue.send_failed", { job: jobKey(job), error: String(e) }); return false; }
}

type Row = { id: string; kind: string; payload: string; attempts: number };
/** Atomically leases up to `max` ready jobs (never transcode: those need ffmpeg and go to the transcode worker). */
export async function claimJobs(max: number, kind: "web" | "transcode", leaseMs = LEASE_MS): Promise<Row[]> {
  const now = Date.now();
  const where = kind === "transcode" ? "kind = 'transcode'" : "kind != 'transcode'";
  const r = await d1<Row>(
    `UPDATE jobs SET locked_until = ?1, attempts = attempts + 1
     WHERE id IN (SELECT id FROM jobs WHERE ${where} AND run_after <= ?2 AND locked_until <= ?2 ORDER BY created_at LIMIT ?3)
     RETURNING id, kind, payload, attempts`, [now + leaseMs, now, max]);
  return r.results;
}
export const finishJob = (id: string) => d1("DELETE FROM jobs WHERE id = ?1", [id]);
export const retryJob = (id: string, delaySec: number) => d1("UPDATE jobs SET locked_until = 0, run_after = ?2 WHERE id = ?1", [id, Date.now() + delaySec * 1000]);

type Handler = (j: SearchJob & { v: 1 }) => Promise<unknown>;
/** Consumer: one batch. Safe for duplicate delivery (Redis done-marker per job key per 10 min). */
export async function processBatch(handle: Handler, max = 25) {
  const rows = await claimJobs(max, "web");
  const out = { received: rows.length, done: 0, duplicate: 0, retried: 0, dead: 0, stats: 0 };
  const statRows = rows.filter((m) => parseJob(m.payload)?.kind === "poststat");
  if (statRows.length) {
    const { applyStatJobs } = await import("./post-stats.server");
    try {
      await applyStatJobs(statRows.map((m) => parseJob(m.payload) as StatJob & { v: 1 }));
      await d1(`DELETE FROM jobs WHERE id IN (${statRows.map((_, n) => `?${n + 1}`).join(",")})`, statRows.map((m) => m.id));
      out.stats += statRows.length; out.done += statRows.length;
    } catch (e) {
      out.retried += statRows.length; // lease expires, picked up again later
      log("warn", "queue.stats_retry", { n: statRows.length, error: String(e).slice(0, 200) });
    }
  }
  for (const m of rows) {
    if (statRows.includes(m)) continue;
    const job = parseJob(m.payload);
    if (!job) { await redisPipeline([["LPUSH", DEAD_KEY, JSON.stringify({ id: m.id, reason: "invalid" })], ["LTRIM", DEAD_KEY, 0, 999]]); await finishJob(m.id); out.dead++; continue; }
    const key = `lg:jobs:done:${jobKey(job)}`;
    if ((await redis(["GET", key])) === "1") { await finishJob(m.id); out.duplicate++; continue; }
    try {
      await handle(job as SearchJob & { v: 1 });
      await redis(["SET", key, "1", "EX", 600]);
      await finishJob(m.id); out.done++;
    } catch (e) {
      const permanent = /\b4\d\d\b/.test(String(e)) && !/\b429\b/.test(String(e));
      if (failureAction(m.attempts, permanent) === "dead") {
        await redisPipeline([["LPUSH", DEAD_KEY, JSON.stringify({ id: m.id, job, reason: String(e).slice(0, 200) })], ["LTRIM", DEAD_KEY, 0, 999]]);
        await finishJob(m.id).catch(() => {}); out.dead++;
        log("error", "queue.dead_letter", { job: jobKey(job), attempts: m.attempts, error: String(e) });
      } else {
        await retryJob(m.id, backoffSeconds(m.attempts)).catch(() => {});
        out.retried++;
        log("warn", "queue.retry", { job: jobKey(job), attempts: m.attempts, error: String(e) });
      }
    }
  }
  return out;
}
export async function queueStats() {
  const now = Date.now();
  const r = await d1<{ waiting: number; inFlight: number }>(
    "SELECT SUM(CASE WHEN locked_until <= ?1 THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN locked_until > ?1 THEN 1 ELSE 0 END) AS inFlight FROM jobs", [now]);
  const dead = Number((await redis(["LLEN", DEAD_KEY])) ?? 0);
  return { waiting: Number(r.results[0]?.waiting ?? 0), inFlight: Number(r.results[0]?.inFlight ?? 0), dead };
}
